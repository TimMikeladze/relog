export type LogLevel =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal";

export const LOG_LEVELS: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
	fatal: 60,
};

export interface LogRecord {
	id?: number;
	timestamp: string;
	level: LogLevel;
	message: string;
	meta?: Record<string, unknown>;
	service?: string;
	host?: string;
	pid?: number;
	trace_id?: string;
	span_id?: string;
	created_at?: number;
}
