import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
	CREATE_ANALYTICS_INDEXES,
	CREATE_EVENTS_TABLE,
	CREATE_EVENT_ROLLUPS_TABLE,
	CREATE_SESSIONS_TABLE,
	CREATE_VISITOR_HOURS_TABLE,
	CREATE_VISITOR_SALTS_TABLE,
	ROLLUP_DIMENSIONS,
	type RollupDimension,
} from "./analytics-schema.ts";
import { VisitorSalts } from "../analytics/visitor.ts";

export const HOUR_MS: number = 3_600_000;
export const DAY_MS: number = 86_400_000;

/** Sessions idle longer than this are considered ended (Umami/GA convention). */
export const SESSION_TIMEOUT_MS: number = 30 * 60_000;

export interface AnalyticsEvent {
	site: string;
	name: string;
	visitor_id: string;
	session_id: string;
	hostname?: string | null;
	path?: string | null;
	path_raw?: string | null;
	title?: string | null;
	referrer_host?: string | null;
	referrer_path?: string | null;
	utm_source?: string | null;
	utm_medium?: string | null;
	utm_campaign?: string | null;
	utm_term?: string | null;
	utm_content?: string | null;
	country?: string | null;
	region?: string | null;
	city?: string | null;
	browser?: string | null;
	os?: string | null;
	device?: string | null;
	screen?: string | null;
	language?: string | null;
	props?: Record<string, unknown> | null;
	revenue?: number | null;
	duration_ms?: number | null;
	created_at: number;
}

export interface Overview {
	views: number;
	visitors: number;
	sessions: number;
	bounce_rate: number;
	avg_session_seconds: number;
	views_per_session: number;
}

export interface TimeseriesPoint {
	bucket: number;
	views: number;
	visitors: number;
	sessions: number;
}

export interface RealtimeSummary {
	active_sessions: number;
	window_ms: number;
	pages: { value: string; views: number }[];
}

export interface BreakdownRow {
	value: string;
	views: number;
	visitors: number | null;
}

export interface AnalyticsRange {
	site: string;
	from: number;
	to: number;
}

export type TimeUnit = "hour" | "day";

export function floorHour(ts: number): number {
	return Math.floor(ts / HOUR_MS) * HOUR_MS;
}

/** '' rather than NULL: SQLite treats NULLs as distinct in a PRIMARY KEY, which would defeat the rollup upsert. */
function dim(v: string | null | undefined): string {
	return v ?? "";
}

const PAGEVIEW = "pageview";

export class AnalyticsStore {
	private db: Database;
	private readonlyDb: Database;
	readonly salts: VisitorSalts;

	constructor(db: Database, readonlyDb: Database) {
		this.db = db;
		this.readonlyDb = readonlyDb;
		this.db.exec(CREATE_EVENTS_TABLE);
		this.db.exec(CREATE_EVENT_ROLLUPS_TABLE);
		this.db.exec(CREATE_VISITOR_HOURS_TABLE);
		this.db.exec(CREATE_SESSIONS_TABLE);
		this.db.exec(CREATE_VISITOR_SALTS_TABLE);
		for (const idx of CREATE_ANALYTICS_INDEXES) {
			this.db.exec(idx);
		}
		this.salts = new VisitorSalts(db);
	}

	/**
	 * Writes raw rows, rollups, visitor set and session state in one
	 * transaction. Rollups are maintained synchronously rather than by a
	 * background job because it removes a whole class of failure — no
	 * watermark to fall behind, no window where the dashboard disagrees with
	 * the raw table, and raw rows stay independently prunable.
	 */
	insert(events: AnalyticsEvent[], keyPrefix?: string, storeRaw = true): void {
		if (events.length === 0) return;

		const rawStmt = this.db.prepare(`
			INSERT INTO events (
				site, name, visitor_id, session_id, hostname, path, path_raw, title,
				referrer_host, referrer_path, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
				country, region, city, browser, os, device, screen, language,
				props, revenue, duration_ms, key_prefix, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const rollupStmt = this.db.prepare(`
			INSERT INTO event_rollups (
				site, bucket, name, path, referrer_host, utm_source, utm_medium, utm_campaign,
				country, device, browser, os, views, revenue, duration_sum, duration_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
			ON CONFLICT(site, bucket, name, path, referrer_host, utm_source, utm_medium, utm_campaign, country, device, browser, os)
			DO UPDATE SET
				views = views + 1,
				revenue = revenue + excluded.revenue,
				duration_sum = duration_sum + excluded.duration_sum,
				duration_count = duration_count + excluded.duration_count
		`);

		const visitorStmt = this.db.prepare(
			"INSERT INTO visitor_hours (site, bucket, visitor_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
		);

		const sessionStmt = this.db.prepare(`
			INSERT INTO sessions (
				site, session_id, visitor_id, started_at, last_seen_at, views, events,
				entry_path, exit_path, referrer_host, utm_source, country, device, browser, os
			) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(site, session_id) DO UPDATE SET
				last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
				started_at = MIN(started_at, excluded.started_at),
				views = views + excluded.views,
				events = events + 1,
				-- entry_path sticks to the first pageview; a session that opens with a
				-- custom event would otherwise never get one.
				entry_path = COALESCE(entry_path, excluded.entry_path),
				exit_path = COALESCE(excluded.exit_path, exit_path)
		`);

		this.db.transaction(() => {
			for (const e of events) {
				const bucket = floorHour(e.created_at);
				const isPageview = e.name === PAGEVIEW;
				const duration = typeof e.duration_ms === "number" ? e.duration_ms : null;

				if (storeRaw) {
					rawStmt.run(
						e.site,
						e.name,
						e.visitor_id,
						e.session_id,
						e.hostname ?? null,
						e.path ?? null,
						e.path_raw ?? null,
						e.title ?? null,
						e.referrer_host ?? null,
						e.referrer_path ?? null,
						e.utm_source ?? null,
						e.utm_medium ?? null,
						e.utm_campaign ?? null,
						e.utm_term ?? null,
						e.utm_content ?? null,
						e.country ?? null,
						e.region ?? null,
						e.city ?? null,
						e.browser ?? null,
						e.os ?? null,
						e.device ?? null,
						e.screen ?? null,
						e.language ?? null,
						e.props ? JSON.stringify(e.props) : null,
						e.revenue ?? null,
						duration,
						keyPrefix ?? null,
						e.created_at,
					);
				}

				rollupStmt.run(
					e.site,
					bucket,
					e.name,
					dim(e.path),
					dim(e.referrer_host),
					dim(e.utm_source),
					dim(e.utm_medium),
					dim(e.utm_campaign),
					dim(e.country),
					dim(e.device),
					dim(e.browser),
					dim(e.os),
					e.revenue ?? 0,
					duration ?? 0,
					duration === null ? 0 : 1,
				);

				visitorStmt.run(e.site, bucket, e.visitor_id);

				sessionStmt.run(
					e.site,
					e.session_id,
					e.visitor_id,
					e.created_at,
					e.created_at,
					isPageview ? 1 : 0,
					isPageview ? (e.path ?? null) : null,
					isPageview ? (e.path ?? null) : null,
					e.referrer_host ?? null,
					e.utm_source ?? null,
					e.country ?? null,
					e.device ?? null,
					e.browser ?? null,
					e.os ?? null,
				);
			}
		})();
	}

	/** Distinct sites seen, most recently active first. */
	listSites(): { site: string; last_seen_at: number; views: number }[] {
		return this.readonlyDb
			.prepare(
				`SELECT site, MAX(bucket) AS last_seen_at, SUM(views) AS views
				 FROM event_rollups GROUP BY site ORDER BY last_seen_at DESC`,
			)
			.all() as { site: string; last_seen_at: number; views: number }[];
	}

	overview({ site, from, to }: AnalyticsRange): Overview {
		const totals = this.readonlyDb
			.prepare(
				`SELECT COALESCE(SUM(views), 0) AS views
				 FROM event_rollups
				 WHERE site = ? AND name = ? AND bucket >= ? AND bucket < ?`,
			)
			.get(site, PAGEVIEW, floorHour(from), to) as { views: number };

		const visitors = this.readonlyDb
			.prepare(
				`SELECT COUNT(DISTINCT visitor_id) AS visitors
				 FROM visitor_hours WHERE site = ? AND bucket >= ? AND bucket < ?`,
			)
			.get(site, floorHour(from), to) as { visitors: number };

		const sessions = this.readonlyDb
			.prepare(
				`SELECT
					COUNT(*) AS sessions,
					COALESCE(SUM(CASE WHEN views <= 1 THEN 1 ELSE 0 END), 0) AS bounced,
					COALESCE(SUM(last_seen_at - started_at), 0) AS duration_sum,
					COALESCE(SUM(views), 0) AS session_views
				 FROM sessions WHERE site = ? AND started_at >= ? AND started_at < ?`,
			)
			.get(site, from, to) as {
			sessions: number;
			bounced: number;
			duration_sum: number;
			session_views: number;
		};

		const n = sessions.sessions;
		return {
			views: totals.views,
			visitors: visitors.visitors,
			sessions: n,
			bounce_rate: n === 0 ? 0 : round(sessions.bounced / n, 4),
			avg_session_seconds: n === 0 ? 0 : round(sessions.duration_sum / n / 1000, 1),
			views_per_session: n === 0 ? 0 : round(sessions.session_views / n, 2),
		};
	}

	/**
	 * Views come from the rollups, visitors from `visitor_hours`, sessions
	 * from `sessions` — three different grains that cannot be joined into one
	 * scan without either double-counting views or under-counting uniques.
	 * Three cheap indexed aggregates merged in JS is both correct and faster
	 * than any single-query formulation.
	 */
	timeseries({ site, from, to }: AnalyticsRange, unit: TimeUnit = "hour"): TimeseriesPoint[] {
		const step = unit === "day" ? DAY_MS : HOUR_MS;
		const start = Math.floor(from / step) * step;
		const bucketExpr = unit === "day" ? `(bucket / ${DAY_MS}) * ${DAY_MS}` : "bucket";

		const points = new Map<number, TimeseriesPoint>();
		for (let b = start; b < to; b += step) {
			points.set(b, { bucket: b, views: 0, visitors: 0, sessions: 0 });
		}
		const bump = (b: number, key: "views" | "visitors" | "sessions", n: number) => {
			const p = points.get(b);
			if (p) p[key] += n;
		};

		const viewRows = this.readonlyDb
			.prepare(
				`SELECT ${bucketExpr} AS b, SUM(views) AS n FROM event_rollups
				 WHERE site = ? AND name = ? AND bucket >= ? AND bucket < ? GROUP BY b`,
			)
			.all(site, PAGEVIEW, start, to) as { b: number; n: number }[];
		for (const r of viewRows) bump(r.b, "views", r.n);

		// COUNT(DISTINCT) per bucket, not summed across buckets: a visitor
		// active in three hours is three hourly uniques but one daily unique.
		const visitorRows = this.readonlyDb
			.prepare(
				`SELECT ${bucketExpr} AS b, COUNT(DISTINCT visitor_id) AS n FROM visitor_hours
				 WHERE site = ? AND bucket >= ? AND bucket < ? GROUP BY b`,
			)
			.all(site, start, to) as { b: number; n: number }[];
		for (const r of visitorRows) bump(r.b, "visitors", r.n);

		const sessionRows = this.readonlyDb
			.prepare(
				`SELECT (started_at / ${step}) * ${step} AS b, COUNT(*) AS n FROM sessions
				 WHERE site = ? AND started_at >= ? AND started_at < ? GROUP BY b`,
			)
			.all(site, start, to) as { b: number; n: number }[];
		for (const r of sessionRows) bump(r.b, "sessions", r.n);

		return [...points.values()];
	}

	/**
	 * Per-value unique visitors require the raw `events` table — `visitor_hours`
	 * carries no dimensions, by design (adding them would multiply its row
	 * count by the dimension cardinality and defeat its purpose). When the
	 * requested range predates raw retention, views still come from the
	 * rollups and `visitors` is reported as null rather than as a wrong number.
	 */
	breakdown(
		{ site, from, to }: AnalyticsRange,
		dimension: RollupDimension,
		limit = 20,
		eventName: string = PAGEVIEW,
	): BreakdownRow[] {
		if (!ROLLUP_DIMENSIONS.includes(dimension)) {
			throw new Error(`Unknown breakdown dimension: ${dimension}`);
		}
		const cap = Math.min(Math.max(1, Math.floor(limit)), 500);

		if (this.rawCovers(site, from)) {
			const rows = this.readonlyDb
				.prepare(
					`SELECT COALESCE(${dimension}, '') AS value,
					        COUNT(*) AS views,
					        COUNT(DISTINCT visitor_id) AS visitors
					 FROM events
					 WHERE site = ? AND name = ? AND created_at >= ? AND created_at < ?
					 GROUP BY value ORDER BY views DESC LIMIT ?`,
				)
				.all(site, eventName, from, to, cap) as BreakdownRow[];
			return rows;
		}

		const rows = this.readonlyDb
			.prepare(
				`SELECT ${dimension} AS value, SUM(views) AS views
				 FROM event_rollups
				 WHERE site = ? AND name = ? AND bucket >= ? AND bucket < ?
				 GROUP BY value ORDER BY views DESC LIMIT ?`,
			)
			.all(site, eventName, floorHour(from), to, cap) as { value: string; views: number }[];
		return rows.map((r) => ({ ...r, visitors: null }));
	}

	/** Distinct custom event names with counts, for the events tab. */
	eventNames({ site, from, to }: AnalyticsRange, limit = 50): { name: string; views: number }[] {
		const cap = Math.min(Math.max(1, Math.floor(limit)), 500);
		return this.readonlyDb
			.prepare(
				`SELECT name, SUM(views) AS views FROM event_rollups
				 WHERE site = ? AND bucket >= ? AND bucket < ? AND name != ?
				 GROUP BY name ORDER BY views DESC LIMIT ?`,
			)
			.all(site, floorHour(from), to, PAGEVIEW, cap) as { name: string; views: number }[];
	}

	/**
	 * "Active now" is sessions touched inside the window, not visitors — a
	 * visitor hash is stable for a whole UTC day, so counting those would keep
	 * reporting people who closed the tab hours ago.
	 */
	realtime(site: string, windowMs: number = 5 * 60_000, now: number = Date.now()): RealtimeSummary {
		const since = now - windowMs;
		const active = this.readonlyDb
			.prepare("SELECT COUNT(*) AS n FROM sessions WHERE site = ? AND last_seen_at >= ?")
			.get(site, since) as { n: number };
		const pages = this.readonlyDb
			.prepare(
				`SELECT path AS value, COUNT(*) AS views FROM events
				 WHERE site = ? AND name = ? AND created_at >= ?
				 GROUP BY path ORDER BY views DESC LIMIT 10`,
			)
			.all(site, PAGEVIEW, since) as { value: string; views: number }[];
		return { active_sessions: active.n, window_ms: windowMs, pages };
	}

	/**
	 * Retention/GC. Raw events are dropped in batches; rollups, visitor hours
	 * and sessions get their own (much longer) horizon since they are what the
	 * dashboard actually reads.
	 */
	pruneRawEvents(before: number, maxIterations = 100): number {
		const batchSize = 10_000;
		const stmt = this.db.prepare(
			`DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE created_at < ? LIMIT ${batchSize})`,
		);
		let total = 0;
		for (let i = 0; i < maxIterations; i++) {
			const res = stmt.run(before);
			total += res.changes;
			if (res.changes < batchSize) break;
		}
		return total;
	}

	pruneAggregates(before: number): number {
		let total = 0;
		this.db.transaction(() => {
			total += this.db.prepare("DELETE FROM event_rollups WHERE bucket < ?").run(before).changes;
			total += this.db.prepare("DELETE FROM visitor_hours WHERE bucket < ?").run(before).changes;
			total += this.db.prepare("DELETE FROM sessions WHERE last_seen_at < ?").run(before).changes;
		})();
		return total;
	}

	stats(): { events: number; rollups: number; sessions: number; sites: number } {
		const one = (sql: string): number =>
			(this.readonlyDb.prepare(sql).get() as { n: number } | null)?.n ?? 0;
		return {
			events: one("SELECT COUNT(*) AS n FROM events"),
			rollups: one("SELECT COUNT(*) AS n FROM event_rollups"),
			sessions: one("SELECT COUNT(*) AS n FROM sessions"),
			sites: one("SELECT COUNT(DISTINCT site) AS n FROM event_rollups"),
		};
	}

	/**
	 * True when no raw rows have been pruned out from under the rollups.
	 *
	 * The test is "does raw reach as far back as the rollups do", not "does raw
	 * reach back to `from`" — a window that simply predates the site's first
	 * event has no raw rows either, and treating that as a retention gap would
	 * silently drop unique-visitor counts for every young site.
	 */
	private rawCovers(site: string, from: number): boolean {
		const row = this.readonlyDb
			.prepare(
				`SELECT
					(SELECT MIN(created_at) FROM events WHERE site = ?) AS oldest_raw,
					(SELECT MIN(bucket) FROM event_rollups WHERE site = ?) AS oldest_rollup`,
			)
			.get(site, site) as { oldest_raw: number | null; oldest_rollup: number | null };

		// No rollups means no data at all for this site; nothing to be missing.
		if (row.oldest_rollup === null) return true;
		if (row.oldest_raw === null) return false;
		// Raw rows carry exact timestamps, rollups carry hour boundaries, so the
		// raw side must be floored before the two are comparable.
		return floorHour(row.oldest_raw) <= Math.max(row.oldest_rollup, floorHour(from));
	}

	/** Escape hatch for read-only ad-hoc SQL bound to the analytics tables. */
	select<T = Record<string, unknown>>(sql: string, params: SQLQueryBindings[] = []): T[] {
		return this.readonlyDb.prepare(sql).all(...params) as T[];
	}
}

function round(n: number, places: number): number {
	const f = 10 ** places;
	return Math.round(n * f) / f;
}
