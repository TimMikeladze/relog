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
	parent_span_id?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	duration_ms?: number;
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
	/** Retry config for S3 archive uploads during prune */
	retry?: RetryConfig;
}

export interface AnalyticsConfig {
	/** Master switch for /collect, /script.js and /analytics/*. Default: false. */
	enabled: boolean;
	/**
	 * Allowlist of site ids accepted by /collect. Strongly recommended: the
	 * collect endpoint must be reachable by anonymous browsers, so without an
	 * allowlist anyone who finds the URL can create unlimited sites.
	 */
	sites?: string[];
	/**
	 * Require an ingest key on /collect. Off by default because a key embedded
	 * in a public tracker script is not a secret; turn it on for server-side
	 * or first-party-proxied collection where a key can actually be kept.
	 */
	requireKey?: boolean;
	/** Per-IP collect requests per minute. Default: 600. */
	collectRpm?: number;
	/** Count known bots and crawlers as visitors. Default: false. */
	includeBots?: boolean;
	/** Drop events from clients sending `DNT: 1`. Default: false. */
	respectDnt?: boolean;
	/**
	 * Keep the raw per-event rows. Rollups are always written, so disabling
	 * this still gives working dashboards at a fraction of the storage — at
	 * the cost of per-dimension unique visitors and the realtime page list.
	 * Default: true.
	 */
	storeRawEvents?: boolean;
	/** Store the un-normalized path alongside the normalized one. Default: false. */
	storeRawPaths?: boolean;
	/** Days to keep raw events. Rollups outlive them. Default: 90. */
	rawRetentionDays?: number;
	/** Days to keep rollups, visitor hours and sessions. Default: 730. */
	aggregateRetentionDays?: number;
}

export interface ServerConfig {
	port: number;
	dbPath: string;
	/**
	 * Directory for the JSON side-stores (aggregates, widgets, dashboards).
	 * Defaults to `~/.relog`. Set it when running more than one server on a
	 * machine, or they will overwrite each other's saved dashboards.
	 */
	dataDir?: string;
	ingestKeys?: string[];
	readKeys?: string[];
	adminKeys?: string[];
	keyPrefixLength?: number;
	cors?: boolean | string | string[];
	maxBodySize?: number;
	maxBatchSize?: number;
	streamDebounceMs?: number;
	ingestRpm?: number;
	/** TCP idle timeout in seconds (default: 60). */
	idleTimeout?: number;
	/**
	 * Trust the X-Forwarded-For header for the client IP. Only enable when
	 * deployed behind a reverse proxy that is known to set this header
	 * (ALB, GCP LB, Cloudflare, nginx). When false (default), the socket
	 * peer address is used so a malicious client cannot spoof IPs and
	 * bypass per-IP rate limiting.
	 */
	trustProxy?: boolean;
	autoPrune?: AutoPruneConfig;
	archive?: ArchiveConfig;
	analytics?: AnalyticsConfig;
	uiDistPath?: string;
	/**
	 * Path to sources YAML config file for continuous external log ingestion.
	 * @internal Experimental — not part of the public API. May change or be removed.
	 */
	sourcesConfigPath?: string;
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
	/** S3 URL style: 'path' for MinIO/self-hosted, 'vhost' for AWS S3. Default: 'path'. */
	urlStyle?: "path" | "vhost";
}

export interface RetryConfig {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export interface ArchiveBatchResult {
	succeededIds: number[];
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
	parent_span_id?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	duration_ms?: number;
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

export type WidgetKind =
	| "stat"
	| "line"
	| "bar"
	| "table"
	| "status-grid"
	| "heatmap"
	| "gauge"
	| "sparkline";

export interface StatOptions {
	valueField: string;
	deltaField?: string;
	format?: "number" | "bytes" | "ms" | "percent";
}

export interface LineOptions {
	xField: string;
	yFields: string[];
	yFormat?: "number" | "ms" | "percent";
	seriesField?: string;
}

export interface BarOptions {
	categoryField: string;
	valueField: string;
	orientation?: "horizontal" | "vertical";
}

export interface TableColumn {
	field: string;
	label?: string;
	format?: "number" | "bytes" | "ms" | "timestamp";
}

export interface TableOptions {
	columns: TableColumn[];
}

export interface StatusGridOptions {
	labelField: string;
	statusField: string;
	thresholds: { healthy: number; degraded: number };
}

export interface HeatmapOptions {
	xField: string;
	yField: string;
	valueField: string;
}

export interface GaugeOptions {
	valueField: string;
	min?: number;
	max: number;
	thresholds?: { warn: number; crit: number };
}

export interface SparklineOptions {
	xField: string;
	yField: string;
}

export type WidgetOptions =
	| StatOptions
	| LineOptions
	| BarOptions
	| TableOptions
	| StatusGridOptions
	| HeatmapOptions
	| GaugeOptions
	| SparklineOptions;

export interface WidgetLayout {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Widget {
	id: string;
	name: string;
	description?: string;
	kind: WidgetKind;
	sql: string;
	options: WidgetOptions;
	layout: WidgetLayout;
	timeRange?: string;
	/**
	 * Dashboard this widget belongs to. Absent means the default dashboard,
	 * so widgets created before dashboards existed keep showing up where
	 * their author left them.
	 */
	dashboardId?: string;
	createdAt: number;
	updatedAt: number;
	builtin?: boolean;
}

export interface WidgetsFile {
	version: 1;
	widgets: Widget[];
}

/**
 * A dashboard variable becomes a `${name}` placeholder available to every
 * widget on that dashboard.
 *
 * This is what keeps the dashboard layer generic. The widget SQL is already
 * arbitrary, but before variables the only things a user could filter by were
 * `service` and `project` — hardcoded because logs happen to have those
 * columns. A dashboard over analytics wants `site`, one over a Kubernetes
 * cluster wants `namespace`, one over a multi-tenant app wants `tenant`.
 * Declaring them per dashboard means none of that has to be known here.
 */
export type VariableType = "text" | "select" | "number";

export interface VariableOption {
	label: string;
	value: string;
}

export interface DashboardVariable {
	/** Placeholder name. Referenced in widget SQL as `${name}`. */
	name: string;
	label?: string;
	description?: string;
	type: VariableType;
	/** Initial value. Omit (or use null) to start on "All" for a select. */
	default?: string | number | null;
	/** Static choices for a `select`. */
	options?: VariableOption[];
	/**
	 * SQL that produces the choices for a `select`, as a `value` column and an
	 * optional `label` column. Lets a variable enumerate whatever is actually
	 * in the database — sites, services, tenants — without the server knowing
	 * what any of those are.
	 */
	optionsSql?: string;
	/** Offer an "All" choice that substitutes NULL. Default: true. */
	includeAll?: boolean;
}

export interface Dashboard {
	id: string;
	name: string;
	description?: string;
	/** lucide-react icon name, rendered by the client if it recognizes it. */
	icon?: string;
	/** Ordering in the dashboard picker; lower sorts first. */
	order?: number;
	variables?: DashboardVariable[];
	/** Default time range label (`1h`, `24h`, `7d`, …) when first opened. */
	defaultTimeRange?: string;
	createdAt: number;
	updatedAt: number;
	builtin?: boolean;
}

export interface DashboardsFile {
	version: 1;
	dashboards: Dashboard[];
}
