import type { LogLevel, SamplingOptions } from "./types.ts";
import { LOG_LEVELS } from "./types.ts";

export type EventSink = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;

function getHeader(
	headers: { get?: (name: string) => string | null; [key: string]: unknown } | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	if (typeof headers.get === "function") return headers.get(name) ?? undefined;
	const val = (headers as Record<string, unknown>)[name];
	return typeof val === "string" ? val : undefined;
}

export class EventBuilder {
	private name: string;
	private data: Record<string, unknown> = {};
	private level: LogLevel = "info";
	private sink: EventSink;
	private startTime: number;
	private ended = false;
	private forceKeep = false;
	private sampling: SamplingOptions;

	constructor(
		name: string,
		sink: EventSink,
		initialMeta?: Record<string, unknown>,
		sampling?: SamplingOptions,
	) {
		this.name = name;
		this.sink = sink;
		this.startTime = performance.now();
		this.sampling = sampling ?? {};
		if (initialMeta) {
			Object.assign(this.data, initialMeta);
		}
	}

	set(key: string, value: unknown): this;
	set(obj: Record<string, unknown>): this;
	set(keyOrObj: string | Record<string, unknown>, value?: unknown): this {
		if (typeof keyOrObj === "string") {
			this.data[keyOrObj] = value;
		} else {
			Object.assign(this.data, keyOrObj);
		}
		return this;
	}

	error(err: Error): this {
		this.data.error = err.message;
		this.data.error_name = err.name;
		this.data.error_stack = err.stack;
		this.escalate("error");
		return this;
	}

	warn(message?: string): this {
		if (message) {
			this.data.warning = message;
		}
		this.escalate("warn");
		return this;
	}

	keep(): this {
		this.forceKeep = true;
		return this;
	}

	request(req: { method?: string; url?: string; headers?: Record<string, unknown> }): this {
		if (req.method) this.data.http_method = req.method;
		if (req.url) {
			try {
				const parsed = new URL(req.url, "http://localhost");
				this.data.http_path = parsed.pathname;
			} catch {
				this.data.http_path = req.url;
			}
		}

		const traceId = getHeader(req.headers, "x-trace-id") ?? getHeader(req.headers, "x-request-id");
		if (traceId) this.data.trace_id = traceId;
		const userAgent = getHeader(req.headers, "user-agent");
		if (userAgent) this.data.user_agent = userAgent;

		return this;
	}

	response(res: { status?: number; statusCode?: number }): this {
		const status = res.status ?? res.statusCode;
		if (status !== undefined) {
			this.data.http_status = status;
			if (status >= 500) {
				this.escalate("error");
			}
		}
		return this;
	}

	end(): void {
		if (this.ended) return;
		this.ended = true;

		const duration_ms = Math.round((performance.now() - this.startTime) * 100) / 100;

		if (!this.shouldKeep(duration_ms)) return;

		const meta: Record<string, unknown> = {
			...this.data,
			duration_ms,
			event: true,
		};

		const sampleRate = this.sampling.sampleRate;
		if (sampleRate !== undefined && sampleRate < 1) {
			meta.sample_rate = sampleRate;
		}

		this.sink(this.level, this.name, meta);
	}

	[Symbol.dispose](): void {
		this.end();
	}

	private shouldKeep(duration_ms: number): boolean {
		if (this.forceKeep) return true;
		if (LOG_LEVELS[this.level] >= LOG_LEVELS.error) return true;
		if (
			this.sampling.slowThresholdMs !== undefined &&
			duration_ms > this.sampling.slowThresholdMs
		) {
			return true;
		}

		const rate = this.sampling.sampleRate;
		if (rate === undefined || rate >= 1) return true;
		if (rate <= 0) return false;
		return Math.random() < rate;
	}

	private escalate(level: LogLevel): void {
		if (LOG_LEVELS[level] > LOG_LEVELS[this.level]) {
			this.level = level;
		}
	}
}
