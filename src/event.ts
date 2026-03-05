import type { LogLevel } from "./types.ts";
import { LOG_LEVELS } from "./types.ts";

export type EventSink = (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;

export class EventBuilder {
	private name: string;
	private data: Record<string, unknown> = {};
	private level: LogLevel = "info";
	private sink: EventSink;
	private startTime: number;
	private ended = false;

	constructor(name: string, sink: EventSink, initialMeta?: Record<string, unknown>) {
		this.name = name;
		this.sink = sink;
		this.startTime = performance.now();
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

	end(): void {
		if (this.ended) return;
		this.ended = true;

		const duration_ms = Math.round((performance.now() - this.startTime) * 100) / 100;

		this.sink(this.level, this.name, {
			...this.data,
			duration_ms,
			event: true,
		});
	}

	[Symbol.dispose](): void {
		this.end();
	}

	private escalate(level: LogLevel): void {
		if (LOG_LEVELS[level] > LOG_LEVELS[this.level]) {
			this.level = level;
		}
	}
}
