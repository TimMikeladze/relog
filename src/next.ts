import type { Logger } from "./logger.ts";
import type { Transport } from "./transport.ts";
import type { LogLevel, LogRecord } from "./types.ts";

export interface RelogNextConfig {
	url?: string;
	service?: string;
	auth?: string;
	level?: LogLevel;
	captureConsole?: boolean;
	traceHeader?: string;
	batchSize?: number;
	flushInterval?: number;
}

let singleton: Logger | null = null;
let singletonTransport: Transport | null = null;
let singletonConfig: ReturnType<typeof resolveConfig> | null = null;
let logProxyWarned = false;

const originalConsole = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
};

let _insideRelog = false;

function resolveConfig(config: RelogNextConfig) {
	return {
		url: config.url ?? process.env.RELOG_URL ?? "http://localhost:3485",
		service: config.service ?? "next",
		auth: config.auth ?? process.env.RELOG_AUTH,
		level: config.level ?? "info",
		captureConsole: config.captureConsole ?? true,
		traceHeader: config.traceHeader ?? "x-trace-id",
		batchSize: config.batchSize,
		flushInterval: config.flushInterval,
	} as const;
}

function safeStringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function patchConsole(logger: Logger): void {
	const levelMap: Record<string, LogLevel> = {
		log: "info",
		info: "info",
		warn: "warn",
		error: "error",
		debug: "debug",
	};

	for (const [method, level] of Object.entries(levelMap)) {
		const original =
			originalConsole[method as keyof typeof originalConsole];
		(console as unknown as Record<string, unknown>)[method] = (
			...args: unknown[]
		) => {
			// Always call original so terminal output is preserved
			original.apply(console, args);

			// Guard against recursion (e.g. Transport's own console.warn on failure)
			if (_insideRelog) return;
			_insideRelog = true;
			try {
				const message = args.map(safeStringify).join(" ");
				logger[
					level as keyof Pick<
						Logger,
						"info" | "warn" | "error" | "debug"
					>
				](message, {
					source: "console",
				});
			} finally {
				_insideRelog = false;
			}
		};
	}
}

export function restoreConsole(): void {
	console.log = originalConsole.log;
	console.info = originalConsole.info;
	console.warn = originalConsole.warn;
	console.error = originalConsole.error;
	console.debug = originalConsole.debug;
}

function generateTraceId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function withRelog(config: RelogNextConfig = {}) {
	const resolved = resolveConfig(config);

	async function register() {
		if (singleton) return;

		// Dynamic imports so that middleware.ts (Edge runtime) can import
		// relog/next without pulling in node:os / node:child_process.
		const { Transport } = await import("./transport.ts");
		const { Logger } = await import("./logger.ts");

		singletonTransport = new Transport({
			url: resolved.url,
			auth: resolved.auth,
			batchSize: resolved.batchSize,
			flushInterval: resolved.flushInterval,
			onError(error) {
				_insideRelog = true;
				try {
					originalConsole.warn(
						`[relog] Transport error: ${error.message}`,
					);
				} finally {
					_insideRelog = false;
				}
			},
		});

		singleton = new Logger(
			{
				service: resolved.service,
				level: resolved.level,
				console: false,
			},
			singletonTransport,
		);

		singletonConfig = resolved;

		if (resolved.captureConsole) {
			patchConsole(singleton);
		}
	}

	function onRequestError(
		error: unknown,
		request: {
			method: string;
			url: string;
			headers: Record<string, string>;
		},
		context: {
			routerKind: string;
			routePath: string;
			routeType: string;
			renderSource?: string;
		},
	) {
		if (!singleton) return;

		const err =
			error instanceof Error ? error : new Error(String(error));

		singleton.error(err, {
			source: "onRequestError",
			method: request.method,
			url: request.url,
			routerKind: context.routerKind,
			routePath: context.routePath,
			routeType: context.routeType,
			renderSource: context.renderSource,
		});
	}

	return {
		register: register as () => Promise<void>,
		onRequestError: onRequestError as (
			error: unknown,
			request: {
				method: string;
				url: string;
				headers: Record<string, string>;
			},
			context: {
				routerKind: string;
				routePath: string;
				routeType: string;
				renderSource?: string;
			},
		) => void,
	};
}

export function relogMiddleware(
	userMiddleware?: (request: Request) => Response | Promise<Response>,
) {
	return async (
		request: Request,
	): Promise<Response | undefined> => {
		const start = Date.now();
		const traceId = generateTraceId();
		const url = new URL(request.url);
		const traceHeader = singletonConfig?.traceHeader ?? "x-trace-id";
		const isEdge =
			typeof process !== "undefined" &&
			process.env.NEXT_RUNTIME === "edge";

		let response: Response | undefined;
		if (userMiddleware) {
			response = await userMiddleware(request);

			// Add trace header to user middleware response
			const headers = new Headers(response.headers);
			headers.set(traceHeader, traceId);
			response = new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}
		// When no user middleware, return undefined so Next.js continues
		// routing normally. We can't create a NextResponse.next() without
		// depending on next/server.

		const duration = Date.now() - start;
		const status = response?.status ?? 0;
		const service = singletonConfig?.service ?? "next";
		const record: LogRecord = {
			timestamp: new Date().toISOString(),
			level: "info",
			message: `${request.method} ${url.pathname} ${status} ${duration}ms`,
			service,
			meta: {
				source: "middleware",
				method: request.method,
				path: url.pathname,
				status,
				duration,
				trace_id: traceId,
			},
			trace_id: traceId,
		};

		if (isEdge) {
			// In Edge runtime, send directly via fetch to avoid Node.js dependencies
			const edgeUrl =
				process.env.RELOG_URL ?? "http://localhost:3485";
			const edgeHeaders: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const auth = process.env.RELOG_AUTH;
			if (auth) {
				edgeHeaders["Authorization"] = `Basic ${btoa(auth)}`;
			}
			fetch(`${edgeUrl}/ingest`, {
				method: "POST",
				headers: edgeHeaders,
				body: JSON.stringify([record]),
			}).catch(() => {
				// Silently drop in edge — no console to avoid noise
			});
		} else if (singleton) {
			singleton.info(record.message, record.meta);
		}

		return response;
	};
}

function warnIfNoSingleton(): void {
	if (!singleton && !logProxyWarned) {
		logProxyWarned = true;
		originalConsole.warn(
			"[relog] log.* called before register(). Logs will be dropped until withRelog().register() is called.",
		);
	}
}

/** Proxy to the singleton Logger for explicit structured logging. */
export const log: Pick<
	Logger,
	"trace" | "debug" | "info" | "warn" | "error" | "fatal" | "flush"
> = {
	trace(message, meta?) {
		warnIfNoSingleton();
		singleton?.trace(message, meta);
	},
	debug(message, meta?) {
		warnIfNoSingleton();
		singleton?.debug(message, meta);
	},
	info(message, meta?) {
		warnIfNoSingleton();
		singleton?.info(message, meta);
	},
	warn(message, meta?) {
		warnIfNoSingleton();
		singleton?.warn(message, meta);
	},
	error(message, meta?) {
		warnIfNoSingleton();
		singleton?.error(message, meta);
	},
	fatal(message, meta?) {
		warnIfNoSingleton();
		singleton?.fatal(message, meta);
	},
	async flush() {
		await singleton?.flush();
	},
};

/** Reset singleton — exposed for testing only. */
export function _resetSingleton(): void {
	if (singletonTransport) {
		singletonTransport.destroy();
		singletonTransport = null;
	}
	singleton = null;
	singletonConfig = null;
	logProxyWarned = false;
	restoreConsole();
}
