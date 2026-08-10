import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteFile } from "../atomic-write.ts";
import type { Widget, WidgetsFile } from "../types.ts";
import { DEFAULT_DASHBOARD_ID } from "./dashboards.ts";

export class WidgetsManager {
	private widgets: Map<string, Widget> = new Map();
	private filePath: string | null;

	constructor(filePath?: string) {
		this.filePath = filePath || null;
	}

	async init(): Promise<void> {
		for (const w of DEFAULT_WIDGETS) {
			this.widgets.set(w.id, w);
		}
		if (!this.filePath) return;
		let raw: string;
		try {
			raw = await fs.readFile(this.filePath, "utf-8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				// First run / fresh install — seed the file so future writes succeed.
				await this.persist();
				return;
			}
			// Anything else (EACCES, EIO, EISDIR) is an operator/FS issue. Don't
			// overwrite — that would risk destroying real user data on a transient
			// read failure.
			throw new Error(
				`[relog.dev] Failed to read widgets file ${this.filePath}: ${err instanceof Error ? err.message : err}`,
			);
		}
		try {
			const parsed = JSON.parse(raw) as WidgetsFile | Widget[];
			const list = Array.isArray(parsed) ? parsed : parsed.widgets;
			for (const w of list) {
				this.widgets.set(w.id, w);
			}
		} catch (err) {
			throw new Error(
				`[relog.dev] Widgets file ${this.filePath} is corrupted: ${err instanceof Error ? err.message : err}. Move/restore it manually.`,
			);
		}
	}

	async add(widget: Omit<Widget, "createdAt" | "updatedAt">): Promise<Widget> {
		const now = Date.now();
		const w: Widget = { ...widget, createdAt: now, updatedAt: now };
		this.widgets.set(w.id, w);
		await this.persist();
		return w;
	}

	async update(
		id: string,
		updates: Partial<Omit<Widget, "id" | "createdAt">>,
	): Promise<Widget | null> {
		const existing = this.widgets.get(id);
		if (!existing) return null;
		const updated: Widget = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};
		this.widgets.set(id, updated);
		await this.persist();
		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const w = this.widgets.get(id);
		if (!w) return false;
		if (w.builtin) return false;
		this.widgets.delete(id);
		await this.persist();
		return true;
	}

	getAll(): Widget[] {
		return Array.from(this.widgets.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string): Widget | null {
		return this.widgets.get(id) || null;
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			await fs.mkdir(dirname(this.filePath), { recursive: true });
			const body: WidgetsFile = {
				version: 1,
				widgets: Array.from(this.widgets.values()),
			};
			await atomicWriteFile(this.filePath, JSON.stringify(body, null, 2));
		} catch (err) {
			console.error("[relog.dev] Failed to persist widgets:", err);
		}
	}
}

const BUILTIN_TS = 0;

const LOG_WIDGETS: Widget[] = [
	{
		id: "total-logs",
		name: "Total Logs",
		description: "Count of logs in the selected range",
		kind: "stat",
		sql: "SELECT COUNT(*) AS value FROM logs WHERE created_at BETWEEN ${from} AND ${to}",
		options: { valueField: "value", format: "number" },
		layout: { x: 0, y: 0, w: 4, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "error-rate",
		name: "Error Rate",
		description: "Percent of logs at error or fatal level",
		kind: "stat",
		sql: `
			SELECT
				CASE WHEN COUNT(*) = 0 THEN 0
				ELSE SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
				END AS value
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
		`,
		options: { valueField: "value", format: "percent" },
		layout: { x: 4, y: 0, w: 8, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "log-volume",
		name: "Log Volume",
		description: "Log count per minute bucket",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS BIGINT) * 60000 AS bucket,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["count"], yFormat: "number" },
		layout: { x: 0, y: 2, w: 12, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "errors-over-time",
		name: "Errors Over Time",
		description: "Error+fatal log count per minute bucket",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS BIGINT) * 60000 AS bucket,
				COUNT(*) AS errors
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND level IN ('error','fatal')
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["errors"], yFormat: "number" },
		layout: { x: 0, y: 6, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "throughput",
		name: "Throughput per Service",
		description: "Logs per minute by service",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS BIGINT) * 60000 AS bucket,
				service,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND service IS NOT NULL
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket, service
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["count"], yFormat: "number", seriesField: "service" },
		layout: { x: 6, y: 6, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "latency-p50-p95-p99",
		name: "Latency Percentiles",
		description: "p50 / p95 / p99 of wide-event duration_ms per minute",
		kind: "line",
		sql: `
			WITH durations AS (
				SELECT
					CAST(created_at / 60000 AS BIGINT) * 60000 AS bucket,
					CAST(json_extract(meta, '$.duration_ms') AS REAL) AS d
				FROM logs
				WHERE created_at BETWEEN \${from} AND \${to}
					AND json_extract(meta, '$.duration_ms') IS NOT NULL
					AND (\${service} IS NULL OR service = \${service})
					AND (\${project} IS NULL OR project = \${project})
			),
			ranked AS (
				SELECT bucket, d,
					ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY d) AS rn,
					COUNT(*) OVER (PARTITION BY bucket) AS n
				FROM durations
			)
			SELECT bucket,
				MAX(CASE WHEN rn = CAST(n * 0.50 AS INTEGER) + 1 THEN d END) AS p50,
				MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN d END) AS p95,
				MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN d END) AS p99
			FROM ranked
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["p50", "p95", "p99"], yFormat: "ms" },
		layout: { x: 0, y: 10, w: 12, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "service-health",
		name: "Service Health",
		description: "Error percent per service over the selected range",
		kind: "status-grid",
		sql: `
			SELECT
				service,
				CASE WHEN COUNT(*) = 0 THEN 0
				ELSE SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
				END AS error_pct
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND service IS NOT NULL
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY service
			ORDER BY service
		`,
		options: {
			labelField: "service",
			statusField: "error_pct",
			thresholds: { healthy: 1, degraded: 5 },
		},
		layout: { x: 0, y: 14, w: 12, h: 3 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "project-branch",
		name: "Project × Branch",
		description: "Log count grouped by project and branch",
		kind: "bar",
		sql: `
			SELECT
				COALESCE(project, '—') || ' · ' || COALESCE(branch, '—') AS label,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND project IS NOT NULL
			GROUP BY project, branch
			ORDER BY count DESC
			LIMIT 15
		`,
		options: { categoryField: "label", valueField: "count", orientation: "horizontal" },
		layout: { x: 0, y: 17, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "top-errors",
		name: "Top Error Messages",
		description: "Most frequent error/fatal messages with last-seen timestamp",
		kind: "table",
		sql: `
			SELECT
				message,
				COUNT(*) AS count,
				MAX(timestamp) AS last_seen
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND level IN ('error','fatal')
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY message
			ORDER BY count DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "message", label: "Message" },
				{ field: "count", label: "Count", format: "number" },
				{ field: "last_seen", label: "Last seen", format: "timestamp" },
			],
		},
		layout: { x: 6, y: 17, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "slowest-events",
		name: "Slowest Wide Events",
		description: "Wide events with the largest duration_ms",
		kind: "table",
		sql: `
			SELECT
				message,
				service,
				CAST(json_extract(meta, '$.duration_ms') AS REAL) AS duration_ms
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND json_extract(meta, '$.event') = 1
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			ORDER BY duration_ms DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "message", label: "Event" },
				{ field: "service", label: "Service" },
				{ field: "duration_ms", label: "Duration", format: "ms" },
			],
		},
		layout: { x: 0, y: 21, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "recent-errors",
		name: "Recent Errors",
		description: "Ten most recent error/fatal logs",
		kind: "table",
		sql: `
			SELECT
				timestamp,
				level,
				service,
				message
			FROM logs
			WHERE level IN ('error','fatal')
			ORDER BY created_at DESC
			LIMIT 10
		`,
		options: {
			columns: [
				{ field: "timestamp", label: "Time", format: "timestamp" },
				{ field: "level", label: "Level" },
				{ field: "service", label: "Service" },
				{ field: "message", label: "Message" },
			],
		},
		layout: { x: 6, y: 21, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
];

/**
 * Widgets for the built-in Web Analytics dashboard.
 *
 * Every query reads `${site}` and `${device}` — the variables that dashboard
 * declares — using the `(${var} IS NULL OR col = ${var})` idiom so an unset
 * variable means "all" without needing a second query.
 *
 * Which table each metric comes from is deliberate: views and dimensional
 * breakdowns come from `event_rollups` (small, and outlives raw retention),
 * unique visitors from `visitor_hours` (uniques cannot be summed across
 * rollup buckets), and session metrics from `sessions`.
 */
const ANALYTICS_WIDGETS: Widget[] = [
	{
		id: "analytics-visitors",
		name: "Unique Visitors",
		description: "Distinct visitors in the selected range",
		kind: "stat",
		// visitor_hours carries no device column — adding one would multiply its
		// row count by the dimension cardinality and defeat its purpose. So when
		// a device is selected, fall through to the raw events table instead.
		// Exactly one branch contributes: `device = NULL` is never true, and the
		// first branch is gated on the variable being unset.
		sql: `
			SELECT COUNT(DISTINCT visitor_id) AS value FROM (
				SELECT visitor_id FROM visitor_hours
				WHERE bucket BETWEEN \${from} AND \${to}
					AND (\${site} IS NULL OR site = \${site})
					AND \${device} IS NULL
				UNION ALL
				SELECT visitor_id FROM events
				WHERE created_at BETWEEN \${from} AND \${to}
					AND (\${site} IS NULL OR site = \${site})
					AND device = \${device}
			)
		`,
		options: { valueField: "value", format: "number" },
		layout: { x: 0, y: 0, w: 3, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-pageviews",
		name: "Pageviews",
		description: "Total pageviews in the selected range",
		kind: "stat",
		sql: `
			SELECT COALESCE(SUM(views), 0) AS value
			FROM event_rollups
			WHERE name = 'pageview'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
		`,
		options: { valueField: "value", format: "number" },
		layout: { x: 3, y: 0, w: 3, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-bounce-rate",
		name: "Bounce Rate",
		description: "Share of sessions with a single pageview",
		kind: "stat",
		sql: `
			SELECT
				CASE WHEN COUNT(*) = 0 THEN 0
				ELSE SUM(CASE WHEN views <= 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
				END AS value
			FROM sessions
			WHERE started_at BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
		`,
		options: { valueField: "value", format: "percent" },
		layout: { x: 6, y: 0, w: 3, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-session-duration",
		name: "Avg Session",
		description: "Mean time between a session's first and last event",
		kind: "stat",
		sql: `
			SELECT COALESCE(AVG(last_seen_at - started_at), 0) AS value
			FROM sessions
			WHERE started_at BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
		`,
		options: { valueField: "value", format: "ms" },
		layout: { x: 9, y: 0, w: 3, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-traffic",
		name: "Traffic",
		description: "Pageviews and sessions per hour",
		kind: "line",
		// Views and sessions live at different grains and cannot be joined into
		// one scan without double-counting, so each is aggregated separately and
		// merged on the bucket.
		sql: `
			WITH views AS (
				SELECT bucket, SUM(views) AS pageviews
				FROM event_rollups
				WHERE name = 'pageview'
					AND bucket BETWEEN \${from} AND \${to}
					AND (\${site} IS NULL OR site = \${site})
					AND (\${device} IS NULL OR device = \${device})
				GROUP BY bucket
			),
			sess AS (
				SELECT CAST(started_at / 3600000 AS BIGINT) * 3600000 AS bucket, COUNT(*) AS sessions
				FROM sessions
				WHERE started_at BETWEEN \${from} AND \${to}
					AND (\${site} IS NULL OR site = \${site})
					AND (\${device} IS NULL OR device = \${device})
				GROUP BY bucket
			)
			SELECT
				COALESCE(v.bucket, s.bucket) AS bucket,
				COALESCE(v.pageviews, 0) AS pageviews,
				COALESCE(s.sessions, 0) AS sessions
			FROM views v
			FULL OUTER JOIN sess s ON v.bucket = s.bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["pageviews", "sessions"], yFormat: "number" },
		layout: { x: 0, y: 2, w: 12, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-top-pages",
		name: "Top Pages",
		description: "Most-viewed paths",
		kind: "bar",
		sql: `
			SELECT path AS label, SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY path
			ORDER BY views DESC
			LIMIT 15
		`,
		options: { categoryField: "label", valueField: "views", orientation: "horizontal" },
		layout: { x: 0, y: 6, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-top-referrers",
		name: "Top Referrers",
		description: "Where visitors arrived from; '' is direct traffic",
		kind: "bar",
		sql: `
			SELECT
				CASE WHEN referrer_host = '' THEN 'Direct' ELSE referrer_host END AS label,
				SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY label
			ORDER BY views DESC
			LIMIT 15
		`,
		options: { categoryField: "label", valueField: "views", orientation: "horizontal" },
		layout: { x: 6, y: 6, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-countries",
		name: "Countries",
		description: "Pageviews by country, when a geo-aware proxy is trusted",
		kind: "bar",
		sql: `
			SELECT country AS label, SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND country != ''
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY country
			ORDER BY views DESC
			LIMIT 12
		`,
		options: { categoryField: "label", valueField: "views", orientation: "horizontal" },
		layout: { x: 0, y: 11, w: 4, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-browsers",
		name: "Browsers",
		description: "Pageviews by browser",
		kind: "bar",
		sql: `
			SELECT browser AS label, SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY browser
			ORDER BY views DESC
			LIMIT 12
		`,
		options: { categoryField: "label", valueField: "views", orientation: "horizontal" },
		layout: { x: 4, y: 11, w: 4, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-devices",
		name: "Devices",
		description: "Pageviews by device class and OS",
		kind: "bar",
		sql: `
			SELECT device || ' · ' || os AS label, SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY label
			ORDER BY views DESC
			LIMIT 12
		`,
		options: { categoryField: "label", valueField: "views", orientation: "horizontal" },
		layout: { x: 8, y: 11, w: 4, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-entry-pages",
		name: "Entry Pages",
		description: "Where sessions start, and how often they bounce",
		kind: "table",
		sql: `
			SELECT
				entry_path AS path,
				COUNT(*) AS sessions,
				SUM(CASE WHEN views <= 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS bounce_pct
			FROM sessions
			WHERE entry_path IS NOT NULL
				AND started_at BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY entry_path
			ORDER BY sessions DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "path", label: "Entry page" },
				{ field: "sessions", label: "Sessions", format: "number" },
				{ field: "bounce_pct", label: "Bounce %", format: "number" },
			],
		},
		layout: { x: 0, y: 15, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-events",
		name: "Custom Events",
		description: "Non-pageview events with their revenue, if any",
		kind: "table",
		sql: `
			SELECT
				name AS event,
				SUM(views) AS count,
				SUM(revenue) AS revenue
			FROM event_rollups
			WHERE name NOT IN ('pageview', 'leave')
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY name
			ORDER BY count DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "event", label: "Event" },
				{ field: "count", label: "Count", format: "number" },
				{ field: "revenue", label: "Revenue", format: "number" },
			],
		},
		layout: { x: 6, y: 15, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-campaigns",
		name: "Campaigns",
		description: "Pageviews by UTM source, medium and campaign",
		kind: "table",
		sql: `
			SELECT
				utm_source AS source,
				utm_medium AS medium,
				utm_campaign AS campaign,
				SUM(views) AS views
			FROM event_rollups
			WHERE name = 'pageview'
				AND utm_source != ''
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY source, medium, campaign
			ORDER BY views DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "source", label: "Source" },
				{ field: "medium", label: "Medium" },
				{ field: "campaign", label: "Campaign" },
				{ field: "views", label: "Views", format: "number" },
			],
		},
		layout: { x: 0, y: 19, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics-time-on-page",
		name: "Time on Page",
		description: "Median dwell time per path, from `leave` events",
		kind: "table",
		sql: `
			SELECT
				path,
				SUM(duration_count) AS samples,
				SUM(duration_sum) / NULLIF(SUM(duration_count), 0) AS avg_ms
			FROM event_rollups
			WHERE name = 'leave'
				AND bucket BETWEEN \${from} AND \${to}
				AND (\${site} IS NULL OR site = \${site})
				AND (\${device} IS NULL OR device = \${device})
			GROUP BY path
			HAVING SUM(duration_count) > 0
			ORDER BY samples DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "path", label: "Page" },
				{ field: "samples", label: "Samples", format: "number" },
				{ field: "avg_ms", label: "Avg time", format: "ms" },
			],
		},
		layout: { x: 6, y: 19, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
];

function onDashboard(dashboardId: string): (w: Widget) => Widget {
	return (w) => ({ ...w, dashboardId });
}

export const DEFAULT_WIDGETS: Widget[] = [
	...LOG_WIDGETS.map(onDashboard(DEFAULT_DASHBOARD_ID)),
	...ANALYTICS_WIDGETS.map(onDashboard("analytics")),
];
