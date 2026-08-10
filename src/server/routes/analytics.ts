import type { RelogDatabase } from "../../db/database.ts";
import { DAY_MS, HOUR_MS, type TimeUnit } from "../../db/analytics.ts";
import { ROLLUP_DIMENSIONS, type RollupDimension } from "../../db/analytics-schema.ts";
import { logRouteError } from "../log.ts";
import { TRACKER_ETAG, TRACKER_SCRIPT } from "../../analytics/tracker-script.ts";

const DEFAULT_WINDOW_MS = 24 * 3_600_000;
const MAX_WINDOW_MS = 400 * 86_400_000;

interface Range {
	site: string;
	from: number;
	to: number;
}

/**
 * Accepts either absolute epoch-ms bounds or a relative `period` (`24h`,
 * `7d`, `30d`, `12mo`). The window is capped because every read path scans
 * buckets proportional to its length, and an unbounded `from=0` would let an
 * unauthenticated-ish read key walk the entire history in one request.
 */
function parseRange(url: URL, now: number): Range | Response {
	const site = url.searchParams.get("site");
	if (!site) {
		return Response.json({ error: "Missing required parameter: site" }, { status: 400 });
	}

	const period = url.searchParams.get("period");
	let from: number;
	let to = now;

	const toParam = url.searchParams.get("to");
	const fromParam = url.searchParams.get("from");

	if (fromParam || toParam) {
		const f = Number(fromParam);
		const t = toParam ? Number(toParam) : now;
		if (!Number.isFinite(f) || !Number.isFinite(t)) {
			return Response.json(
				{ error: "'from' and 'to' must be epoch milliseconds" },
				{ status: 400 },
			);
		}
		from = f;
		to = t;
	} else {
		const windowMs = period ? parsePeriod(period) : DEFAULT_WINDOW_MS;
		if (windowMs === null) {
			return Response.json(
				{ error: "Invalid period. Use forms like 60m, 24h, 7d, 12mo." },
				{ status: 400 },
			);
		}
		from = now - windowMs;
	}

	if (to <= from) {
		return Response.json({ error: "'to' must be greater than 'from'" }, { status: 400 });
	}
	if (to - from > MAX_WINDOW_MS) {
		return Response.json(
			{ error: `Range too large: max ${MAX_WINDOW_MS / 86_400_000} days` },
			{ status: 400 },
		);
	}
	return { site, from, to };
}

const PERIOD_RE = /^(\d+)(m|h|d|w|mo|y)$/;
const PERIOD_UNITS: Record<string, number> = {
	m: 60_000,
	h: HOUR_MS,
	d: DAY_MS,
	w: 7 * DAY_MS,
	mo: 30 * DAY_MS,
	y: 365 * DAY_MS,
};

function parsePeriod(p: string): number | null {
	const m = PERIOD_RE.exec(p.trim());
	if (!m) return null;
	const n = Number(m[1]);
	const unit = PERIOD_UNITS[m[2]!];
	if (!unit || n <= 0) return null;
	return n * unit;
}

/** Hourly buckets past a couple of weeks produce hundreds of points nobody reads. */
function defaultUnit(from: number, to: number): TimeUnit {
	return to - from > 14 * DAY_MS ? "day" : "hour";
}

export async function handleAnalytics(
	request: Request,
	db: RelogDatabase,
	keyPrefix?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;
	const now = Date.now();

	try {
		if (path === "/analytics/sites") {
			return Response.json({ sites: db.analytics.listSites() });
		}

		if (path === "/analytics/stats") {
			return Response.json(db.analytics.stats());
		}

		if (path === "/analytics/realtime") {
			const site = url.searchParams.get("site");
			if (!site) {
				return Response.json({ error: "Missing required parameter: site" }, { status: 400 });
			}
			const windowMs = clampWindow(url.searchParams.get("window"));
			return Response.json(db.analytics.realtime(site, windowMs, now));
		}

		const range = parseRange(url, now);
		if (range instanceof Response) return range;

		if (path === "/analytics/overview") {
			return Response.json({ ...range, ...db.analytics.overview(range) });
		}

		if (path === "/analytics/timeseries") {
			const unitParam = url.searchParams.get("unit");
			if (unitParam && unitParam !== "hour" && unitParam !== "day") {
				return Response.json({ error: "'unit' must be 'hour' or 'day'" }, { status: 400 });
			}
			const unit: TimeUnit = (unitParam as TimeUnit) ?? defaultUnit(range.from, range.to);
			return Response.json({
				...range,
				unit,
				points: db.analytics.timeseries(range, unit),
			});
		}

		if (path === "/analytics/breakdown") {
			const dimension = url.searchParams.get("dimension") ?? url.searchParams.get("by");
			if (!dimension || !(ROLLUP_DIMENSIONS as readonly string[]).includes(dimension)) {
				return Response.json(
					{ error: `'dimension' must be one of: ${ROLLUP_DIMENSIONS.join(", ")}` },
					{ status: 400 },
				);
			}
			const limit = Number(url.searchParams.get("limit") ?? 20);
			const eventName = url.searchParams.get("event") ?? "pageview";
			return Response.json({
				...range,
				dimension,
				rows: db.analytics.breakdown(
					range,
					dimension as RollupDimension,
					Number.isFinite(limit) ? limit : 20,
					eventName,
				),
			});
		}

		if (path === "/analytics/events") {
			const limit = Number(url.searchParams.get("limit") ?? 50);
			return Response.json({
				...range,
				events: db.analytics.eventNames(range, Number.isFinite(limit) ? limit : 50),
			});
		}

		return Response.json({ error: "Not found" }, { status: 404 });
	} catch (err) {
		logRouteError(`GET ${path}`, err, { keyPrefix });
		return Response.json({ error: "Analytics query failed" }, { status: 500 });
	}
}

const MAX_REALTIME_WINDOW_MS = 60 * 60_000;

function clampWindow(param: string | null): number {
	const n = Number(param);
	if (!Number.isFinite(n) || n <= 0) return 5 * 60_000;
	return Math.min(n, MAX_REALTIME_WINDOW_MS);
}

/**
 * The tracker is served from the same origin that receives the events, which
 * is what makes a one-line integration possible. It is cached for an hour
 * rather than immutably: a tracker fix must reach live sites without every
 * operator editing their script tags.
 */
export function handleTrackerScript(request: Request): Response {
	if (request.headers.get("if-none-match") === TRACKER_ETAG) {
		return new Response(null, { status: 304, headers: { ETag: TRACKER_ETAG } });
	}
	return new Response(TRACKER_SCRIPT, {
		headers: {
			"Content-Type": "application/javascript; charset=utf-8",
			"Cache-Control": "public, max-age=3600, must-revalidate",
			ETag: TRACKER_ETAG,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
