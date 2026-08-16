import type { RelogDatabase } from "../../db/database.ts";
import type { AnalyticsEvent } from "../../db/analytics.ts";
import type { AnalyticsConfig } from "../../types.ts";
import {
	clientIp,
	isBot,
	normalizePath,
	parseGeo,
	parseReferrer,
	parseUserAgent,
	parseUtm,
} from "../../analytics/enrich.ts";
import { utcDay, visitorId } from "../../analytics/visitor.ts";
import { redactMeta } from "../redact.ts";
import { logRouteError } from "../log.ts";

const MAX_BATCH = 50;
const MAX_NAME_LENGTH = 128;
const MAX_SITE_LENGTH = 64;
const MAX_TITLE_LENGTH = 512;
const MAX_PROPS_JSON = 8192;
const MAX_PROPS_KEYS = 32;
const SITE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * A collect payload is whatever the browser felt like sending. Only these
 * fields are read; everything else — including anything that looks like an
 * identity, a country, or a timestamp far from now — is derived or discarded
 * server-side.
 */
interface CollectPayload {
	site?: unknown;
	name?: unknown;
	session_id?: unknown;
	hostname?: unknown;
	path?: unknown;
	query?: unknown;
	title?: unknown;
	referrer?: unknown;
	screen?: unknown;
	language?: unknown;
	touch?: unknown;
	props?: unknown;
	revenue?: unknown;
	duration_ms?: unknown;
	ts?: unknown;
}

export interface CollectContext {
	config: AnalyticsConfig;
	trustProxy: boolean;
	socketAddress?: string | null;
	keyPrefix?: string;
}

/** Bounded so one hostile client cannot spend the server's time on parsing. */
function str(v: unknown, max: number): string | null {
	if (typeof v !== "string") return null;
	const trimmed = v.trim();
	if (trimmed.length === 0) return null;
	return trimmed.slice(0, max);
}

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Revenue has its own column, but the tracker has no way to put anything at the
 * top level of the payload: `relog('purchase', { revenue: 49 })` sends the whole
 * second argument as props. Reading it from either place keeps the documented
 * call working while still accepting a top-level value from server-side
 * collectors — and from trackers already cached in the wild.
 */
function extractRevenue(item: CollectPayload): number | null {
	const top = num(item.revenue);
	if (top !== null) return top;
	const props = item.props;
	if (typeof props !== "object" || props === null || Array.isArray(props)) return null;
	return num((props as Record<string, unknown>).revenue);
}

/**
 * Custom props are the one place arbitrary client data is persisted, so they
 * are capped on key count and serialized size, flattened to scalars, and run
 * through the same redaction the log ingest path uses — a tracker call like
 * `relog('signup', { email })` should not quietly become PII in the database.
 */
function sanitizeProps(v: unknown): Record<string, unknown> | null {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
	const out: Record<string, unknown> = {};
	let n = 0;
	for (const [k, val] of Object.entries(v)) {
		if (n >= MAX_PROPS_KEYS) break;
		if (k.length > 64) continue;
		if (val === null) continue;
		if (typeof val === "string") {
			out[k] = val.slice(0, 512);
		} else if (typeof val === "number" && Number.isFinite(val)) {
			out[k] = val;
		} else if (typeof val === "boolean") {
			out[k] = val;
		} else {
			continue;
		}
		n++;
	}
	if (n === 0) return null;
	const redacted = redactMeta(out) as Record<string, unknown>;
	if (JSON.stringify(redacted).length > MAX_PROPS_JSON) return null;
	return redacted;
}

/**
 * Client clocks are wrong often enough to matter: a skewed device can write
 * events into next year, which then sit at the top of every "recent" query
 * forever and create rollup buckets that never age out. Accept a small window
 * for genuine queued beacons, otherwise use server time.
 */
const MAX_CLOCK_SKEW_PAST_MS = 24 * 3_600_000;
const MAX_CLOCK_SKEW_FUTURE_MS = 60_000;

function resolveTimestamp(ts: unknown, now: number): number {
	const t = num(ts);
	if (t === null) return now;
	if (t > now + MAX_CLOCK_SKEW_FUTURE_MS) return now;
	if (t < now - MAX_CLOCK_SKEW_PAST_MS) return now;
	return t;
}

export async function handleCollect(
	request: Request,
	db: RelogDatabase,
	ctx: CollectContext,
): Promise<Response> {
	const { config, trustProxy } = ctx;

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const items = (Array.isArray(body) ? body : [body]) as CollectPayload[];
	if (items.length === 0) {
		return Response.json({ error: "Empty payload" }, { status: 400 });
	}
	if (items.length > MAX_BATCH) {
		return Response.json(
			{ error: `Batch too large: ${items.length} exceeds max of ${MAX_BATCH}` },
			{ status: 400 },
		);
	}

	const userAgent = request.headers.get("user-agent");

	// Bots are dropped before any work is done, and answered 202 rather than a
	// 4xx — a crawler that gets an error tends to retry, and there is nothing
	// to fix on its end.
	if (!config.includeBots && isBot(userAgent)) {
		return new Response(null, { status: 202 });
	}
	// Respect Do Not Track when configured; the visitor asked.
	if (config.respectDnt && request.headers.get("dnt") === "1") {
		return new Response(null, { status: 202 });
	}

	const now = Date.now();
	const ip = clientIp(request.headers, ctx.socketAddress, trustProxy);
	const geo = parseGeo(request.headers, trustProxy);
	const salt = db.analytics.salts.get(utcDay(now));

	const events: AnalyticsEvent[] = [];

	for (const item of items) {
		const site = str(item.site, MAX_SITE_LENGTH);
		if (!site || !SITE_RE.test(site)) {
			return Response.json(
				{ error: "Invalid event: 'site' must match [a-zA-Z0-9][a-zA-Z0-9._-]*" },
				{ status: 400 },
			);
		}
		// An open collect endpoint with no allowlist is a free write primitive
		// for anyone who finds the URL; `sites` closes it without needing a key
		// the browser cannot keep secret.
		if (config.sites && config.sites.length > 0 && !config.sites.includes(site)) {
			return Response.json({ error: "Unknown site" }, { status: 403 });
		}

		const name = str(item.name, MAX_NAME_LENGTH) ?? "pageview";
		const sessionId = str(item.session_id, 64);
		if (!sessionId) {
			return Response.json({ error: "Invalid event: 'session_id' is required" }, { status: 400 });
		}

		const hostname = str(item.hostname, 255)?.toLowerCase() ?? null;
		const rawPath = str(item.path, 2048) ?? "/";
		const touch = item.touch === true;
		const ua = parseUserAgent(userAgent, { touch });
		const referrer = parseReferrer(str(item.referrer, 2048), hostname);
		const utm = parseUtm(str(item.query, 2048) ?? rawPath.split("?")[1] ?? null);

		events.push({
			site,
			name,
			// Derived here, never accepted from the client — a tracker that could
			// choose its own visitor id could inflate or forge any figure.
			visitor_id: visitorId(salt, site, ip, userAgent ?? ""),
			session_id: sessionId,
			hostname,
			path: normalizePath(rawPath),
			path_raw: config.storeRawPaths ? rawPath.slice(0, 2048) : null,
			title: str(item.title, MAX_TITLE_LENGTH),
			referrer_host: referrer.host,
			referrer_path: referrer.path,
			...utm,
			country: geo.country,
			region: geo.region,
			city: geo.city,
			browser: ua.browser,
			os: ua.os,
			device: ua.device,
			screen: str(item.screen, 32),
			language: str(item.language, 32)?.slice(0, 5) ?? null,
			props: sanitizeProps(item.props),
			revenue: extractRevenue(item),
			duration_ms: clampDuration(num(item.duration_ms)),
			created_at: resolveTimestamp(item.ts, now),
		});
	}

	try {
		db.analytics.insert(events, ctx.keyPrefix, config.storeRawEvents !== false);
	} catch (err) {
		logRouteError("POST /collect", err, {
			keyPrefix: ctx.keyPrefix,
			details: { events: events.length },
		});
		return Response.json({ error: "Collect failed" }, { status: 500 });
	}

	// 204 keeps the response body empty: the tracker never reads it, and an
	// empty response is one fewer thing to serialize on the hottest path.
	return new Response(null, { status: 204 });
}

/**
 * A tab left open overnight reports a multi-hour "time on page" that drags
 * every average with it. Cap at the session timeout — beyond that the visitor
 * was not reading, and the session has already ended by any definition.
 */
const MAX_DURATION_MS = 30 * 60_000;

function clampDuration(d: number | null): number | null {
	if (d === null || d < 0) return null;
	return Math.min(d, MAX_DURATION_MS);
}
