export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const VALID_LEVELS: Set<string> = new Set<string>(["trace", "debug", "info", "warn", "error", "fatal"]);

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
	project?: string;
	branch?: string;
	created_at?: number;
}

export type LogEntry = LogRecord;

export interface LoggerOptions {
	url?: string;
	service?: string;
	auth?: string;
	level?: LogLevel;
	batchSize?: number;
	flushInterval?: number;
	maxBufferSize?: number;
	console?: boolean;
	meta?: Record<string, unknown>;
	traceId?: string;
	spanId?: string;
	project?: string;
	branch?: string;
	onError?: (error: Error, batch: LogRecord[]) => void;
}

export interface AutoPruneConfig {
	/** Max DB size in bytes before auto-prune kicks in */
	maxDbSize?: number;
	/** Max age in days — logs older than this are pruned */
	maxAgeDays?: number;
	/** How often to check thresholds, in seconds (default: 60) */
	intervalSeconds?: number;
}

export interface ServerConfig {
	port: number;
	dbPath: string;
	ingestKey?: string;
	readKey?: string;
	adminKey?: string;
	cors?: boolean | string | string[];
	maxBodySize?: number;
	maxBatchSize?: number;
	streamDebounceMs?: number;
	ingestRpm?: number;
	autoPrune?: AutoPruneConfig;
	archive?: ArchiveConfig;
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
	auto_prune?: {
		max_db_size?: number;
		max_age_days?: number;
		interval_seconds: number;
		db_usage_pct?: number;
	};
}

export interface StreamFilters {
	level?: LogLevel;
	service?: string;
	trace_id?: string;
	project?: string;
	branch?: string;
}

export interface ArchiveConfig {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	prefix?: string;
	region?: string;
}

export interface RetryConfig {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export interface ArchiveResult {
	archived: number;
	failed: number;
	partitions: number;
	errors: string[];
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
	project?: string;
	branch?: string;
}
