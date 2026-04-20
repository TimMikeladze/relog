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
	parent_span_id?: string | null;
	project?: string | null;
	branch?: string | null;
	version?: string | null;
	deployment_id?: string | null;
	duration_ms?: number | null;
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
	bookmarked?: string; // "true" when showing bookmarks only
	around_id?: string; // log ID to center results around
}

export interface Bookmark {
	id: string; // "log:123" | "trace:abc..."
	type: "log" | "trace";
	label: string;
	timestamp: string;
	level?: string;
	service?: string;
	createdAt: number;
	logRecord?: LogRecord; // snapshot for log bookmarks
	traceId?: string; // for trace bookmarks
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

export interface SpanBar {
	name: string;
	service: string;
	spanId: string;
	parentSpanId?: string;
	start: number;
	duration: number;
	level: string;
	depth: number;
	/** OTel span kind: server, client, producer, consumer, internal, unspecified */
	kind?: string;
	/** OTel status code: 0 unset, 1 ok, 2 error */
	statusCode?: number;
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
	createdAt: number;
	updatedAt: number;
	builtin?: boolean;
}

export interface WidgetsFile {
	version: 1;
	widgets: Widget[];
}
