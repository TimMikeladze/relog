import { hostname } from "node:os";
import { printLogRecord } from "./console.ts";
import { EventBuilder } from "./event.ts";
import { inferGitBranch, inferGitProject } from "./git.ts";
import { Transport } from "./transport.ts";
import type { LogLevel, LogRecord, LoggerOptions } from "./types.ts";
import { LOG_LEVELS } from "./types.ts";

const HOSTNAME = hostname();
const PID = process.pid;

function resolveLevel(explicit?: LogLevel): LogLevel {
	if (explicit) return explicit;
	const env = process.env.LOG_LEVEL ?? process.env.RELOG_LEVEL;
	if (env && env in LOG_LEVELS) return env as LogLevel;
	return "info";
}

function resolveAuth(explicit?: string): string | undefined {
	return explicit ?? process.env.RELOG_AUTH;
}

function serializeError(err: Error): Record<string, unknown> {
	return {
		error: err.message,
		name: err.name,
		stack: err.stack,
	};
}

export class Logger {
	private transport: Transport | null;
	private service: string | undefined;
	private level: LogLevel;
	private consoleEnabled: boolean;
	private boundMeta: Record<string, unknown>;
	private traceId: string | undefined;
	private spanId: string | undefined;
	private project: string | undefined;
	private branch: string | undefined;
	private host: string;
	private pid: number;
	private isChild: boolean;

	constructor(options: LoggerOptions = {}, parentTransport?: Transport) {
		this.service = options.service;
		this.level = resolveLevel(options.level);
		this.boundMeta = options.meta ?? {};
		this.traceId = options.traceId;
		this.spanId = options.spanId;
		this.project = options.project ?? inferGitProject();
		this.branch = options.branch ?? inferGitBranch();
		this.host = HOSTNAME;
		this.pid = PID;
		this.isChild = !!parentTransport;

		this.consoleEnabled = options.console ?? process.env.NODE_ENV !== "production";

		if (parentTransport) {
			this.transport = parentTransport;
		} else if (options.url) {
			this.transport = new Transport({
				url: options.url,
				auth: resolveAuth(options.auth),
				batchSize: options.batchSize,
				flushInterval: options.flushInterval,
				maxBufferSize: options.maxBufferSize,
				onError: options.onError,
			});
		} else {
			this.transport = null;
		}
	}

	child(
		meta: Record<string, unknown> & {
			traceId?: string;
			spanId?: string;
			project?: string;
			branch?: string;
		},
	): Logger {
		const { traceId, spanId, project, branch, ...rest } = meta;
		const childLogger = new Logger(
			{
				service: this.service,
				level: this.level,
				console: this.consoleEnabled,
				meta: { ...this.boundMeta, ...rest },
				traceId: traceId ?? this.traceId,
				spanId: spanId ?? this.spanId,
				project: project ?? this.project,
				branch: branch ?? this.branch,
			},
			this.transport ?? undefined,
		);
		return childLogger;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	private log(
		level: LogLevel,
		messageOrError: string | Error,
		meta?: Record<string, unknown>,
	): void {
		if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

		let message: string;
		let finalMeta: Record<string, unknown> | undefined;

		if (messageOrError instanceof Error) {
			message = messageOrError.message;
			finalMeta = {
				...this.boundMeta,
				...serializeError(messageOrError),
				...meta,
			};
		} else {
			message = messageOrError;
			const merged = { ...this.boundMeta, ...meta };
			finalMeta = Object.keys(merged).length > 0 ? merged : undefined;
		}

		const record: LogRecord = {
			timestamp: new Date().toISOString(),
			level,
			message,
			meta: finalMeta,
			service: this.service,
			host: this.host,
			pid: this.pid,
			trace_id: this.traceId,
			span_id: this.spanId,
			project: this.project,
			branch: this.branch,
		};

		if (this.consoleEnabled) {
			printLogRecord(record);
		}

		if (this.transport) {
			this.transport.send(record);
		}
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

	async flush(): Promise<void> {
		if (this.transport) {
			await this.transport.flush();
		}
	}

	async destroy(): Promise<void> {
		if (this.transport && !this.isChild) {
			await this.transport.flush();
			this.transport.destroy();
		}
	}
}

export function createLogger(options: LoggerOptions = {}): Logger {
	return new Logger(options);
}
