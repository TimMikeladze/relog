import type { Logger } from "./logger.ts";
import type { Transport } from "./transport.ts";
import type { IngestPayload, LogLevel, LogRecord } from "./types.ts";
import { VALID_LEVELS } from "./types.ts";

export interface RelogNextConfig {
	url?: string;
	service?: string;
	auth?: string;
	level?: LogLevel;
	captureConsole?: boolean;
	traceHeader?: string;
	batchSize?: number;
	flushInterval?: number;
	version?: string;
	deploymentId?: string;
}

let singleton: Logger | null = null;
let singletonTransport: Transport | null = null;
let singletonConfig: ReturnType<typeof resolveConfig> | null = null;
let logProxyWarned = false;
let edgeIngestWarned = false;

const originalConsole = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
	trace: console.trace,
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
		version: config.version,
		deploymentId: config.deploymentId,
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
		trace: "trace",
	};

	for (const [method, level] of Object.entries(levelMap)) {
		const original = originalConsole[method as keyof typeof originalConsole];
		(console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
			// Always call original so terminal output is preserved
			original.apply(console, args);

			// Guard against recursion (e.g. Transport's own console.warn on failure)
			if (_insideRelog) return;
			_insideRelog = true;
			try {
				const message = args.map(safeStringify).join(" ");
				logger[level as keyof Pick<Logger, "trace" | "info" | "warn" | "error" | "debug">](
					message,
					{ source: "console" },
				);
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
	console.trace = originalConsole.trace;
}

function generateTraceId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function createLogger(config: RelogNextConfig = {}) {
	const resolved = resolveConfig(config);

	async function register() {
		if (singleton) return;

		// Dynamic imports so that middleware.ts (Edge runtime) can import
		// relog.dev/next without pulling in node:os / node:child_process.
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
					originalConsole.warn(`[relog.dev] Transport error: ${error.message}`);
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
				version: resolved.version,
				deploymentId: resolved.deploymentId,
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

		const err = error instanceof Error ? error : new Error(String(error));

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

export function relogProxy(userProxy?: (request: Request) => Response | Promise<Response>) {
	return async (request: Request): Promise<Response | undefined> => {
		const start = Date.now();
		const traceId = generateTraceId();
		const url = new URL(request.url);
		const traceHeader = singletonConfig?.traceHeader ?? "x-trace-id";
		const isEdge = typeof process !== "undefined" && process.env.NEXT_RUNTIME === "edge";

		let response: Response | undefined;
		if (userProxy) {
			response = await userProxy(request);

			// Add trace header to user middleware response
			const headers = new Headers(response.headers);
			headers.set(traceHeader, traceId);
			response = new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}
		// When no user proxy, return undefined so Next.js continues
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
				source: "proxy",
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
			const edgeUrl = process.env.RELOG_URL ?? "http://localhost:3485";
			const edgeHeaders: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const auth = process.env.RELOG_AUTH;
			if (auth) {
				edgeHeaders["Authorization"] = `Bearer ${auth}`;
			}
			const promise = fetch(`${edgeUrl}/ingest`, {
				method: "POST",
				headers: edgeHeaders,
				body: JSON.stringify([record]),
			}).catch((err) => {
				// Drop without crashing the request, but warn once per process
				// so misconfigured RELOG_URL doesn't silently lose all logs.
				if (!edgeIngestWarned) {
					edgeIngestWarned = true;
					originalConsole.warn(
						`[relog.dev] edge-runtime ingest to ${edgeUrl}/ingest failed (further failures suppressed):`,
						err instanceof Error ? err.message : err,
					);
				}
			});
			// Use waitUntil if available (Vercel Edge, Cloudflare Workers)
			// to prevent the runtime from killing the fetch before it completes
			const ctx = (globalThis as Record<string, unknown>).__waitUntil as
				| ((p: Promise<unknown>) => void)
				| undefined;
			if (ctx) {
				ctx(promise);
			}
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
			"[relog.dev] log.* called before register(). Logs will be dropped until createLogger().register() is called.",
		);
	}
}

/** Proxy to the singleton Logger for explicit structured logging. */
export const log: Pick<Logger, "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "flush"> =
	{
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

// ── Browser proxy ──────────────────────────────────────────────────

export interface BrowserProxyOptions {
	/** Relog server URL (default: process.env.RELOG_URL ?? "http://localhost:3485") */
	url?: string;
	/** Auth string (default: process.env.RELOG_AUTH) */
	auth?: string;
	/** Override service name on all proxied entries */
	service?: string;
	/** Max entries per request to prevent abuse (default: 100) */
	maxBatchSize?: number;
	/** Max raw request body in bytes, checked before parsing (default: 1 MiB). */
	maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024;

export function createBrowserProxy(options: BrowserProxyOptions = {}) {
	const url = options.url ?? process.env.RELOG_URL ?? "http://localhost:3485";
	const auth = options.auth ?? process.env.RELOG_AUTH;
	const service = options.service;
	const maxBatchSize = options.maxBatchSize ?? 100;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

	return async (request: Request): Promise<Response> => {
		// Reject oversized bodies up front. Without this, a hostile client
		// posts an arbitrarily large JSON blob and we buffer the whole thing
		// into V8 heap before slicing to maxBatchSize. Trust Content-Length
		// when present; fall back to a streaming length check otherwise.
		const declaredLen = Number(request.headers.get("content-length") ?? "");
		if (Number.isFinite(declaredLen) && declaredLen > maxBodyBytes) {
			return Response.json({ error: "Request body too large" }, { status: 413 });
		}

		let body: unknown;
		try {
			const raw = await readBoundedText(request, maxBodyBytes);
			if (raw === null) {
				return Response.json({ error: "Request body too large" }, { status: 413 });
			}
			body = JSON.parse(raw);
		} catch {
			return Response.json({ error: "Invalid JSON" }, { status: 400 });
		}

		if (!Array.isArray(body)) {
			return Response.json({ error: "Body must be an array" }, { status: 400 });
		}

		const entries = body.slice(0, maxBatchSize) as IngestPayload[];

		// Validate each entry minimally
		for (const entry of entries) {
			if (!entry.level || !VALID_LEVELS.has(entry.level)) {
				return Response.json({ error: "Each entry must have a valid level" }, { status: 400 });
			}
			if (typeof entry.message !== "string") {
				return Response.json({ error: "Each entry must have a string message" }, { status: 400 });
			}
		}

		// Optionally override service
		const finalEntries = service ? entries.map((entry) => ({ ...entry, service })) : entries;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (auth) {
			headers["Authorization"] = `Bearer ${auth}`;
		}

		try {
			const res = await fetch(`${url}/ingest`, {
				method: "POST",
				headers,
				body: JSON.stringify(finalEntries),
			});

			if (!res.ok) {
				const text = await res.text().catch(() => "Unknown error");
				return Response.json({ error: text }, { status: res.status });
			}

			return Response.json({ ingested: entries.length });
		} catch (err) {
			return Response.json(
				{ error: err instanceof Error ? err.message : "Proxy fetch failed" },
				{ status: 502 },
			);
		}
	};
}

/**
 * Read up to `maxBytes` of UTF-8 text from a Request body. Returns `null`
 * when the stream exceeds the cap so the caller can return 413 instead of
 * silently truncating the JSON payload.
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
	const reader = request.body?.getReader();
	if (!reader) return await request.text();
	let total = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			try {
				await reader.cancel();
			} catch {}
			return null;
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder("utf-8").decode(merged);
}

/** Reset singleton — exposed for testing only. */
export function _resetSingleton(): void {
	if (singletonTransport) {
		singletonTransport.destroy();
		singletonTransport = null;
	}
	singleton = null;
	singletonConfig = null;
	logProxyWarned = false;
	edgeIngestWarned = false;
	restoreConsole();
}
