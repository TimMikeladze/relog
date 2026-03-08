export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const VALID_LEVELS: Set<string> = new Set<string>([
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
]);

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
	version?: string;
	deployment_id?: string;
	key_prefix?: string;
	created_at?: number;
}

export type LogEntry = LogRecord;

export interface SamplingOptions {
	/** Sample rate for non-critical events (0-1). Default: 1 (keep all). Only applies to EventBuilder. */
	sampleRate?: number;
	/** Events slower than this (ms) are always kept. Default: undefined (disabled). */
	slowThresholdMs?: number;
}

export interface LoggerOptions extends SamplingOptions {
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
	version?: string;
	deploymentId?: string;
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
	ingestKeys?: string[];
	readKeys?: string[];
	adminKeys?: string[];
	keyPrefixLength?: number;
	cors?: boolean | string | string[];
	maxBodySize?: number;
	maxBatchSize?: number;
	streamDebounceMs?: number;
	ingestRpm?: number;
	autoPrune?: AutoPruneConfig;
	archive?: ArchiveConfig;
	uiDistPath?: string;
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
	level?: string;
	service?: string;
	trace_id?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
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
	version?: string;
	deployment_id?: string;
}

export interface Aggregate {
	id: string;
	name: string;
	description?: string;
	filters: {
		level?: string;
		service?: string;
		project?: string;
		branch?: string;
		version?: string;
		deployment_id?: string;
		grep?: string;
		from?: string;
	};
	icon?: string;
	createdAt: number;
	updatedAt: number;
}
