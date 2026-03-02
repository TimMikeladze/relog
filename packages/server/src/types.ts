export type { LogLevel, LogRecord } from "relog-shared";
export { LOG_LEVELS } from "relog-shared";
import type { LogLevel } from "relog-shared";

export type { LogRecord as LogEntry } from "relog-shared";

export interface ServerConfig {
	port: number;
	dbPath: string;
	auth?: string;
	cors?: boolean | string | string[];
	maxBodySize?: number;
	maxBatchSize?: number;
	streamDebounceMs?: number;
}

export interface QueryResult {
	rows: Record<string, unknown>[];
	count: number;
	time_ms: number;
}

export interface HealthResponse {
	ok: boolean;
	uptime: number;
	db_size_bytes: number;
	log_count: number;
}

export interface StreamFilters {
	level?: LogLevel;
	service?: string;
	trace_id?: string;
}

export interface IngestPayload {
	timestamp?: string;
	level: LogLevel;
	message: string;
	meta?: Record<string, unknown>;
	service?: string;
	host?: string;
	pid?: number;
	trace_id?: string;
	span_id?: string;
}
