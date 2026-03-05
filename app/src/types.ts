export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogRecord {
	id: number;
	timestamp: string;
	level: LogLevel;
	message: string;
	meta?: Record<string, unknown> | string | null;
	service?: string | null;
	host?: string | null;
	pid?: number | null;
	trace_id?: string | null;
	span_id?: string | null;
	project?: string | null;
	branch?: string | null;
	version?: string | null;
	deployment_id?: string | null;
	key_prefix?: string | null;
	created_at?: number | null;
}

export interface HealthResponse {
	ok: boolean;
	uptime: number;
	db_size_bytes: number;
	log_count: number;
	auto_prune?: {
		max_db_size?: number;
		max_age_days?: number;
		interval_seconds: number;
		db_usage_pct?: number;
	};
}

export interface LogsResponse {
	rows: LogRecord[];
	total: number;
	limit: number;
	offset: number;
}

export interface QueryResult {
	rows: Record<string, unknown>[];
	count: number;
	time_ms: number;
}

export type View = "explore" | "traces" | "query" | "dashboard";

export interface Filters {
	level?: string;
	service?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	grep?: string;
	from?: string;
	to?: string;
	trace_id?: string;
}
