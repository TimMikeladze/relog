import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteFile } from "../atomic-write.ts";
import type { Widget, WidgetsFile } from "../types.ts";

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

export const DEFAULT_WIDGETS: Widget[] = [
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
