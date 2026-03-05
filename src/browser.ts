import { EventBuilder } from "./event.ts";
import type { IngestPayload, LogLevel } from "./types.ts";
import { LOG_LEVELS } from "./types.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface BrowserTransportOptions {
	/** Relative URL on the same origin (default: "/api/relog") */
	endpoint?: string;
	/** Flush interval in ms (default: 3000) */
	flushInterval?: number;
	/** Max entries per flush (default: 25) */
	batchSize?: number;
}

export interface BrowserLoggerOptions {
	endpoint?: string;
	flushInterval?: number;
	batchSize?: number;
	level?: LogLevel;
	service?: string;
	project?: string;
	meta?: Record<string, unknown>;
	/** Auto-capture window.onerror + unhandledrejection (default: true) */
	captureErrors?: boolean;
	/** Patch console.log/warn/error to forward to relog (default: false) */
	captureConsole?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────

function generateSessionId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

const SESSION_KEY = "__relog_session_id";

function getSessionId(): string {
	try {
		let id = sessionStorage.getItem(SESSION_KEY);
		if (!id) {
			id = generateSessionId();
			sessionStorage.setItem(SESSION_KEY, id);
		}
		return id;
	} catch {
		// sessionStorage unavailable (e.g. iframe sandbox)
		return ((getSessionId as { _fallback?: string })._fallback ??= generateSessionId());
	}
}

function safeStringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

// ── BrowserTransport ───────────────────────────────────────────────

const BEACON_LIMIT = 60_000; // stay under sendBeacon's ~64KB limit

export class BrowserTransport {
	private endpoint: string;
	private batchSize: number;
	private buffer: IngestPayload[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private destroyed = false;

	constructor(options: BrowserTransportOptions = {}) {
		this.endpoint = options.endpoint ?? "/api/relog";
		this.batchSize = options.batchSize ?? 25;

		this.timer = setInterval(() => this.flush(), options.flushInterval ?? 3_000);

		this.onVisibilityChange = this.onVisibilityChange.bind(this);
		this.onPageHide = this.onPageHide.bind(this);

		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", this.onVisibilityChange);
		}
		if (typeof window !== "undefined") {
			window.addEventListener("pagehide", this.onPageHide);
		}
	}

	send(entry: IngestPayload): void {
		if (this.destroyed) return;
		this.buffer.push(entry);
		if (this.buffer.length >= this.batchSize) {
			this.flush();
		}
	}

	flush(): void {
		if (this.buffer.length === 0) return;
		const batch = this.buffer.splice(0, this.batchSize);
		this.sendViaFetch(batch);
	}

	destroy(): void {
		this.destroyed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", this.onVisibilityChange);
		}
		if (typeof window !== "undefined") {
			window.removeEventListener("pagehide", this.onPageHide);
		}
		this.beaconFlush();
	}

	private sendViaFetch(batch: IngestPayload[]): void {
		fetch(this.endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(batch),
			keepalive: true,
		}).catch(() => {
			// Single retry — proxy is same-origin so failures are rare
			fetch(this.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(batch),
				keepalive: true,
			}).catch(() => {
				// Drop silently after retry
			});
		});
	}

	private beaconFlush(): void {
		if (this.buffer.length === 0) return;
		const all = this.buffer.splice(0);
		const chunks = this.chunkForBeacon(all);
		for (const chunk of chunks) {
			const blob = new Blob([JSON.stringify(chunk)], { type: "application/json" });
			navigator.sendBeacon(this.endpoint, blob);
		}
	}

	private chunkForBeacon(entries: IngestPayload[]): IngestPayload[][] {
		const chunks: IngestPayload[][] = [];
		let current: IngestPayload[] = [];
		let currentSize = 2; // "[]"

		for (const entry of entries) {
			const entryJson = JSON.stringify(entry);
			const added = entryJson.length + (current.length > 0 ? 1 : 0); // comma
			if (currentSize + added > BEACON_LIMIT && current.length > 0) {
				chunks.push(current);
				current = [];
				currentSize = 2;
			}
			current.push(entry);
			currentSize += added;
		}
		if (current.length > 0) chunks.push(current);
		return chunks;
	}

	private onVisibilityChange(): void {
		if (document.visibilityState === "hidden") {
			this.beaconFlush();
		}
	}

	private onPageHide(): void {
		this.beaconFlush();
	}
}

// ── BrowserLogger ──────────────────────────────────────────────────

const originalConsole = {
	log: console.log,
	info: console.info,
	warn: console.warn,
	error: console.error,
	debug: console.debug,
};

export class BrowserLogger {
	private transport: BrowserTransport;
	private level: LogLevel;
	private service: string | undefined;
	private project: string | undefined;
	private boundMeta: Record<string, unknown>;
	private errorCleanup: (() => void) | null = null;
	private consoleCleanup: (() => void) | null = null;

	constructor(options: BrowserLoggerOptions = {}) {
		this.transport = new BrowserTransport({
			endpoint: options.endpoint,
			flushInterval: options.flushInterval,
			batchSize: options.batchSize,
		});
		this.level = options.level ?? "info";
		this.service = options.service;
		this.project = options.project;
		this.boundMeta = options.meta ?? {};

		if (options.captureErrors ?? true) {
			this.hookErrors();
		}
		if (options.captureConsole) {
			this.hookConsole();
		}
	}

	private buildEntry(
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	): IngestPayload {
		const merged = { ...this.boundMeta, ...meta };
		return {
			timestamp: new Date().toISOString(),
			level,
			message,
			service: this.service,
			project: this.project,
			host: typeof location !== "undefined" ? location.hostname : undefined,
			meta: {
				...merged,
				url: typeof location !== "undefined" ? location.href : undefined,
				user_agent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
				session_id: getSessionId(),
				source: "browser",
			},
		};
	}

	private log(
		level: LogLevel,
		messageOrError: string | Error,
		meta?: Record<string, unknown>,
	): void {
		if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

		let message: string;
		let finalMeta = meta;

		if (messageOrError instanceof Error) {
			message = messageOrError.message;
			finalMeta = {
				...meta,
				error: messageOrError.message,
				name: messageOrError.name,
				stack: messageOrError.stack,
			};
		} else {
			message = messageOrError;
		}

		this.transport.send(this.buildEntry(level, message, finalMeta));
	}

	trace(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("trace", message, meta);
	}

	debug(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("debug", message, meta);
	}

	info(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("info", message, meta);
	}

	warn(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("warn", message, meta);
	}

	error(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("error", message, meta);
	}

	fatal(message: string | Error, meta?: Record<string, unknown>): void {
		this.log("fatal", message, meta);
	}

	event(name: string, meta?: Record<string, unknown>): EventBuilder {
		return new EventBuilder(name, (level, message, m) => this.log(level, message, m), {
			...this.boundMeta,
			...meta,
		});
	}

	flush(): void {
		this.transport.flush();
	}

	destroy(): void {
		this.errorCleanup?.();
		this.consoleCleanup?.();
		this.transport.destroy();
	}

	child(meta: Record<string, unknown>): BrowserLogger {
		const child = new BrowserLogger({
			level: this.level,
			service: this.service,
			project: this.project,
			meta: { ...this.boundMeta, ...meta },
			captureErrors: false,
			captureConsole: false,
		});
		// Share transport with parent
		(child as unknown as { transport: BrowserTransport }).transport = this.transport;
		return child;
	}

	private hookErrors(): void {
		if (typeof window === "undefined") return;

		const onError = (event: ErrorEvent) => {
			this.log("error", event.error instanceof Error ? event.error : event.message, {
				source: "window.onerror",
				filename: event.filename,
				lineno: event.lineno,
				colno: event.colno,
			});
		};

		const onRejection = (event: PromiseRejectionEvent) => {
			const reason = event.reason;
			const message = reason instanceof Error ? reason : String(reason);
			this.log("error", message, { source: "unhandledrejection" });
		};

		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);

		this.errorCleanup = () => {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}

	private hookConsole(): void {
		if (typeof console === "undefined") return;

		let _inside = false;
		const levelMap: Record<string, LogLevel> = {
			log: "info",
			info: "info",
			warn: "warn",
			error: "error",
			debug: "debug",
		};

		for (const [method, level] of Object.entries(levelMap)) {
			const original = originalConsole[method as keyof typeof originalConsole];
			(console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
				original.apply(console, args);
				if (_inside) return;
				_inside = true;
				try {
					const message = args.map(safeStringify).join(" ");
					this.log(level, message, { source: "console" });
				} finally {
					_inside = false;
				}
			};
		}

		this.consoleCleanup = () => {
			console.log = originalConsole.log;
			console.info = originalConsole.info;
			console.warn = originalConsole.warn;
			console.error = originalConsole.error;
			console.debug = originalConsole.debug;
		};
	}
}

// ── Singleton / zero-config ────────────────────────────────────────

let singleton: BrowserLogger | null = null;

export function createRelog(options: BrowserLoggerOptions = {}): BrowserLogger {
	if (singleton) {
		singleton.destroy();
	}
	singleton = new BrowserLogger(options);
	return singleton;
}

function getSingleton(): BrowserLogger {
	if (!singleton) {
		singleton = new BrowserLogger();
	}
	return singleton;
}

export const log: Pick<
	BrowserLogger,
	"trace" | "debug" | "info" | "warn" | "error" | "fatal" | "flush" | "destroy" | "child" | "event"
> = {
	trace(message, meta?) {
		getSingleton().trace(message, meta);
	},
	debug(message, meta?) {
		getSingleton().debug(message, meta);
	},
	info(message, meta?) {
		getSingleton().info(message, meta);
	},
	warn(message, meta?) {
		getSingleton().warn(message, meta);
	},
	error(message, meta?) {
		getSingleton().error(message, meta);
	},
	fatal(message, meta?) {
		getSingleton().fatal(message, meta);
	},
	flush() {
		getSingleton().flush();
	},
	destroy() {
		getSingleton().destroy();
		singleton = null;
	},
	child(meta) {
		return getSingleton().child(meta);
	},
	event(name, meta?) {
		return getSingleton().event(name, meta);
	},
};
