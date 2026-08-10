import { rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { RelogDatabase } from "../src/db/database.ts";
import { type AnalyticsEvent, DAY_MS, HOUR_MS, floorHour } from "../src/db/analytics.ts";
import {
	clientIp,
	isBot,
	normalizePath,
	parseGeo,
	parseReferrer,
	parseUserAgent,
	parseUtm,
} from "../src/analytics/enrich.ts";
import { utcDay, visitorId } from "../src/analytics/visitor.ts";
import { pruneAnalyticsOnce } from "../src/analytics/retention.ts";
import { TRACKER_SCRIPT } from "../src/analytics/tracker-script.ts";
import { startServer } from "../src/server/server.ts";
import type { AnalyticsConfig, ServerConfig } from "../src/types.ts";

function tmpPath(prefix: string): string {
	return join(tmpdir(), `relog-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(path + suffix);
		} catch {}
	}
}

// ─── Bot detection ──────────────────────────────────────────────

describe("isBot", () => {
	test("flags common crawlers and tooling", () => {
		const bots = [
			"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Mozilla/5.0 (compatible; bingbot/2.0)",
			"curl/8.4.0",
			"python-requests/2.31.0",
			"Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0",
			"GPTBot/1.0",
			"Mozilla/5.0 (compatible; AhrefsBot/7.0)",
			"facebookexternalhit/1.1",
		];
		for (const ua of bots) {
			expect(isBot(ua)).toBe(true);
		}
	});

	test("does not flag real browsers", () => {
		const humans = [
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
		];
		for (const ua of humans) {
			expect(isBot(ua)).toBe(false);
		}
	});

	test("treats a missing User-Agent as a bot", () => {
		expect(isBot(null)).toBe(true);
		expect(isBot("")).toBe(true);
	});
});

// ─── User-Agent parsing ─────────────────────────────────────────

describe("parseUserAgent", () => {
	test("prefers the most specific browser token", () => {
		// Edge advertises Chrome and Safari; Chrome advertises Safari.
		const edge = parseUserAgent(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
		);
		expect(edge.browser).toBe("Edge");
		expect(edge.os).toBe("Windows");
		expect(edge.device).toBe("desktop");

		const chrome = parseUserAgent(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		);
		expect(chrome.browser).toBe("Chrome");
		expect(chrome.os).toBe("macOS");

		const safari = parseUserAgent(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
		);
		expect(safari.browser).toBe("Safari");
	});

	test("classifies mobile and tablet", () => {
		const iphone = parseUserAgent(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1",
		);
		expect(iphone.device).toBe("mobile");
		expect(iphone.os).toBe("iOS");

		const androidPhone = parseUserAgent(
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
		);
		expect(androidPhone.device).toBe("mobile");
		expect(androidPhone.os).toBe("Android");

		// Android without the "Mobile" token is a tablet.
		const androidTablet = parseUserAgent(
			"Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		);
		expect(androidTablet.device).toBe("tablet");
	});

	test("separates iPadOS from macOS using the touch hint", () => {
		// Byte-identical UA strings; only the touch hint distinguishes them.
		const ua =
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
		const mac = parseUserAgent(ua, { touch: false });
		expect(mac.device).toBe("desktop");
		expect(mac.os).toBe("macOS");

		const ipad = parseUserAgent(ua, { touch: true });
		expect(ipad.device).toBe("tablet");
		expect(ipad.os).toBe("iPadOS");
	});

	test("degrades to Unknown rather than throwing", () => {
		const parsed = parseUserAgent("something entirely unlike a browser");
		expect(parsed.browser).toBe("Unknown");
		expect(parsed.os).toBe("Unknown");
		expect(parsed.device).toBe("desktop");
	});
});

// ─── Referrer ───────────────────────────────────────────────────

describe("parseReferrer", () => {
	test("extracts host and path, stripping www", () => {
		const r = parseReferrer("https://www.google.com/search?q=relog");
		expect(r.host).toBe("google.com");
		expect(r.path).toBe("/search");
	});

	test("treats same-host navigation as no referrer", () => {
		const r = parseReferrer("https://example.com/pricing", "example.com");
		expect(r.host).toBeNull();
		// www vs apex is still the same site.
		expect(parseReferrer("https://www.example.com/x", "example.com").host).toBeNull();
	});

	test("rejects non-http schemes and garbage", () => {
		expect(parseReferrer("javascript:alert(1)").host).toBeNull();
		expect(parseReferrer("not a url").host).toBeNull();
		expect(parseReferrer(null).host).toBeNull();
		expect(parseReferrer("").host).toBeNull();
	});
});

// ─── UTM ────────────────────────────────────────────────────────

describe("parseUtm", () => {
	test("reads standard utm params", () => {
		const utm = parseUtm("?utm_source=twitter&utm_medium=social&utm_campaign=launch");
		expect(utm.utm_source).toBe("twitter");
		expect(utm.utm_medium).toBe("social");
		expect(utm.utm_campaign).toBe("launch");
	});

	test("maps click ids onto a source so paid traffic is not lost to direct", () => {
		const utm = parseUtm("?gclid=abc123");
		expect(utm.utm_source).toBe("google");
		expect(utm.utm_medium).toBe("cpc");

		expect(parseUtm("?fbclid=xyz").utm_source).toBe("facebook");
	});

	test("an explicit utm_source wins over a click id", () => {
		const utm = parseUtm("?utm_source=newsletter&gclid=abc");
		expect(utm.utm_source).toBe("newsletter");
	});

	test("returns nulls for empty input", () => {
		expect(parseUtm(null).utm_source).toBeNull();
		expect(parseUtm("").utm_campaign).toBeNull();
	});
});

// ─── Path normalization ─────────────────────────────────────────

describe("normalizePath", () => {
	test("collapses identifier segments", () => {
		expect(normalizePath("/orders/8123")).toBe("/orders/:id");
		expect(normalizePath("/u/550e8400-e29b-41d4-a716-446655440000/edit")).toBe("/u/:uuid/edit");
		expect(normalizePath("/f/a3f5c9d2e1b48f6a7c9d0e1f")).toBe("/f/:hash");
	});

	test("preserves human-readable slugs", () => {
		expect(normalizePath("/blog/getting-started-with-relog")).toBe(
			"/blog/getting-started-with-relog",
		);
		expect(normalizePath("/docs/api/reference")).toBe("/docs/api/reference");
	});

	test("normalizes trailing slashes, query and hash", () => {
		expect(normalizePath("/pricing/")).toBe("/pricing");
		expect(normalizePath("/pricing?utm_source=x")).toBe("/pricing");
		expect(normalizePath("/pricing#faq")).toBe("/pricing");
		expect(normalizePath("/")).toBe("/");
		expect(normalizePath("")).toBe("/");
		expect(normalizePath(null)).toBe("/");
	});

	test("bounds pathological paths", () => {
		const deep = `/${Array.from({ length: 100 }, (_, i) => `s${i}`).join("/")}`;
		expect(normalizePath(deep).endsWith("/...")).toBe(true);
		expect(normalizePath(`/${"a".repeat(5000)}`).length).toBeLessThanOrEqual(512);
	});
});

// ─── Geo / IP ───────────────────────────────────────────────────

describe("parseGeo", () => {
	test("ignores headers entirely when the proxy is not trusted", () => {
		const h = new Headers({ "cf-ipcountry": "DE" });
		expect(parseGeo(h, false).country).toBeNull();
	});

	test("reads country from any supported edge", () => {
		expect(parseGeo(new Headers({ "cf-ipcountry": "de" }), true).country).toBe("DE");
		expect(parseGeo(new Headers({ "x-vercel-ip-country": "US" }), true).country).toBe("US");
	});

	test("drops placeholder countries", () => {
		expect(parseGeo(new Headers({ "cf-ipcountry": "XX" }), true).country).toBeNull();
		expect(parseGeo(new Headers({ "cf-ipcountry": "T1" }), true).country).toBeNull();
	});

	test("percent-decodes city names", () => {
		const geo = parseGeo(new Headers({ "x-vercel-ip-city": "San%20Francisco" }), true);
		expect(geo.city).toBe("San Francisco");
	});
});

describe("clientIp", () => {
	test("ignores forwarded headers unless the proxy is trusted", () => {
		const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
		expect(clientIp(h, "10.0.0.1", false)).toBe("10.0.0.1");
		expect(clientIp(h, "10.0.0.1", true)).toBe("1.2.3.4");
	});

	test("takes the leftmost forwarded hop", () => {
		const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
		expect(clientIp(h, null, true)).toBe("1.2.3.4");
	});
});

// ─── Visitor identity ───────────────────────────────────────────

describe("visitorId", () => {
	test("is stable for the same inputs and differs across sites", () => {
		const a = visitorId("salt", "site-a", "1.2.3.4", "UA");
		expect(visitorId("salt", "site-a", "1.2.3.4", "UA")).toBe(a);
		expect(visitorId("salt", "site-b", "1.2.3.4", "UA")).not.toBe(a);
		expect(visitorId("salt", "site-a", "1.2.3.5", "UA")).not.toBe(a);
		expect(visitorId("salt2", "site-a", "1.2.3.4", "UA")).not.toBe(a);
	});

	test("does not leak the IP", () => {
		expect(visitorId("salt", "s", "1.2.3.4", "UA")).not.toContain("1.2.3.4");
	});
});

describe("VisitorSalts", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("salts");
		db = new RelogDatabase(dbPath);
	});
	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("returns a stable salt for a day and rotates across days", () => {
		const today = db.analytics.salts.get("2026-01-01");
		expect(db.analytics.salts.get("2026-01-01")).toBe(today);
		expect(db.analytics.salts.get("2026-01-02")).not.toBe(today);
	});

	test("survives a restart so a day's visitors are not split", () => {
		const salt = db.analytics.salts.get(utcDay(Date.now()));
		db.close();
		db = new RelogDatabase(dbPath);
		expect(db.analytics.salts.get(utcDay(Date.now()))).toBe(salt);
	});

	test("purges salts beyond the retention window", () => {
		db.analytics.salts.get("2026-01-01");
		db.analytics.salts.get("2026-01-10");
		const rows = db.analytics.select<{ day: string }>("SELECT day FROM visitor_salts");
		expect(rows.map((r) => r.day)).toEqual(["2026-01-10"]);
	});
});

// ─── Store ──────────────────────────────────────────────────────

const BASE_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);

function event(over: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
	return {
		site: "demo",
		name: "pageview",
		visitor_id: "v1",
		session_id: "s1",
		hostname: "example.com",
		path: "/",
		browser: "Chrome",
		os: "macOS",
		device: "desktop",
		country: "US",
		created_at: BASE_TIME,
		...over,
	};
}

describe("AnalyticsStore", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("analytics");
		db = new RelogDatabase(dbPath);
	});
	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	const range = (from = BASE_TIME - HOUR_MS, to = BASE_TIME + HOUR_MS) => ({
		site: "demo",
		from,
		to,
	});

	test("rollups agree with the raw rows they summarize", () => {
		db.analytics.insert([
			event({ path: "/", visitor_id: "v1", session_id: "s1" }),
			event({ path: "/", visitor_id: "v2", session_id: "s2" }),
			event({ path: "/pricing", visitor_id: "v1", session_id: "s1" }),
		]);

		const raw = db.analytics.select<{ n: number }>("SELECT COUNT(*) AS n FROM events")[0]!;
		const rolled = db.analytics.select<{ n: number }>(
			"SELECT SUM(views) AS n FROM event_rollups",
		)[0]!;
		expect(rolled.n).toBe(raw.n);

		const o = db.analytics.overview(range());
		expect(o.views).toBe(3);
		expect(o.visitors).toBe(2);
		expect(o.sessions).toBe(2);
	});

	test("counts a repeat visitor once", () => {
		for (let i = 0; i < 10; i++) {
			db.analytics.insert([event({ visitor_id: "v1", session_id: "s1", path: `/p${i}` })]);
		}
		const o = db.analytics.overview(range());
		expect(o.views).toBe(10);
		expect(o.visitors).toBe(1);
		expect(o.sessions).toBe(1);
		expect(o.views_per_session).toBe(10);
	});

	test("a session written in the same millisecond as the read is still counted", () => {
		// `to` defaults to Date.now() at read time, so a read can land on the
		// exact millisecond of a write. With an exclusive upper bound on
		// started_at the session vanished while its pageviews still counted —
		// the dashboard showed views with zero sessions.
		const at = BASE_TIME + 5 * 60_000;
		db.analytics.insert([event({ created_at: at, session_id: "s1" })]);
		const o = db.analytics.overview({ site: "demo", from: at - HOUR_MS, to: at });
		expect(o.views).toBe(1);
		expect(o.sessions).toBe(1);

		const points = db.analytics.timeseries({ site: "demo", from: at - HOUR_MS, to: at }, "hour");
		expect(points.reduce((n, p) => n + p.sessions, 0)).toBe(1);
	});

	test("bounce rate counts single-pageview sessions", () => {
		db.analytics.insert([
			event({ session_id: "bounced", visitor_id: "v1" }),
			event({ session_id: "engaged", visitor_id: "v2" }),
			event({ session_id: "engaged", visitor_id: "v2", path: "/pricing" }),
		]);
		const o = db.analytics.overview(range());
		expect(o.sessions).toBe(2);
		expect(o.bounce_rate).toBe(0.5);
	});

	test("non-pageview events do not inflate views but do extend the session", () => {
		db.analytics.insert([
			event({ session_id: "s1" }),
			event({ session_id: "s1", name: "signup", path: "/pricing" }),
		]);
		const o = db.analytics.overview(range());
		expect(o.views).toBe(1);
		expect(o.sessions).toBe(1);

		const names = db.analytics.eventNames(range());
		expect(names).toEqual([{ name: "signup", views: 1 }]);
	});

	test("entry path survives a session that opens with a custom event", () => {
		db.analytics.insert([
			event({ session_id: "s1", name: "consent", path: "/landing" }),
			event({ session_id: "s1", name: "pageview", path: "/landing" }),
			event({ session_id: "s1", name: "pageview", path: "/checkout" }),
		]);
		const s = db.analytics.select<{ entry_path: string; exit_path: string }>(
			"SELECT entry_path, exit_path FROM sessions WHERE session_id = 's1'",
		)[0]!;
		expect(s.entry_path).toBe("/landing");
		expect(s.exit_path).toBe("/checkout");
	});

	test("daily uniques do not double-count a visitor active in several hours", () => {
		db.analytics.insert([
			event({ visitor_id: "v1", session_id: "s1", created_at: BASE_TIME }),
			event({ visitor_id: "v1", session_id: "s2", created_at: BASE_TIME + 2 * HOUR_MS }),
			event({ visitor_id: "v1", session_id: "s3", created_at: BASE_TIME + 4 * HOUR_MS }),
		]);

		const hourly = db.analytics.timeseries(
			{ site: "demo", from: BASE_TIME, to: BASE_TIME + 6 * HOUR_MS },
			"hour",
		);
		expect(hourly.reduce((n, p) => n + p.visitors, 0)).toBe(3);

		const daily = db.analytics.timeseries(
			{ site: "demo", from: BASE_TIME, to: BASE_TIME + 6 * HOUR_MS },
			"day",
		);
		// Same person, one day: exactly one unique, not three.
		expect(daily.reduce((n, p) => n + p.visitors, 0)).toBe(1);

		expect(
			db.analytics.overview({ site: "demo", from: BASE_TIME, to: BASE_TIME + 6 * HOUR_MS })
				.visitors,
		).toBe(1);
	});

	test("timeseries emits an entry for every bucket, including empty ones", () => {
		db.analytics.insert([event()]);
		const points = db.analytics.timeseries(
			{ site: "demo", from: BASE_TIME, to: BASE_TIME + 5 * HOUR_MS },
			"hour",
		);
		expect(points.length).toBe(5);
		expect(points[0]!.views).toBe(1);
		expect(points[1]!.views).toBe(0);
	});

	test("breakdown reports views and uniques per dimension value", () => {
		db.analytics.insert([
			event({ path: "/", visitor_id: "v1", session_id: "s1" }),
			event({ path: "/", visitor_id: "v1", session_id: "s1" }),
			event({ path: "/", visitor_id: "v2", session_id: "s2" }),
			event({ path: "/pricing", visitor_id: "v1", session_id: "s1" }),
		]);
		const rows = db.analytics.breakdown(range(), "path");
		expect(rows[0]).toEqual({ value: "/", views: 3, visitors: 2 });
		expect(rows[1]).toEqual({ value: "/pricing", views: 1, visitors: 1 });
	});

	test("breakdown falls back to rollups, and reports null uniques, once raw rows are gone", () => {
		db.analytics.insert([
			event({ path: "/", visitor_id: "v1" }),
			event({ path: "/", visitor_id: "v2" }),
		]);
		db.analytics.pruneRawEvents(BASE_TIME + HOUR_MS);

		const rows = db.analytics.breakdown(range(), "path");
		expect(rows[0]!.views).toBe(2);
		// Better to say "unknown" than to invent a number the data no longer supports.
		expect(rows[0]!.visitors).toBeNull();
		// Views still reconcile because the rollups outlive the raw rows.
		expect(db.analytics.overview(range()).views).toBe(2);
	});

	test("rejects an unknown breakdown dimension rather than interpolating it", () => {
		expect(() => db.analytics.breakdown(range(), "path; DROP TABLE events" as never)).toThrow();
	});

	test("null dimensions round-trip through the rollup key", () => {
		db.analytics.insert([
			event({ referrer_host: null, country: null }),
			event({ referrer_host: null, country: null }),
		]);
		const rows = db.analytics.breakdown(range(), "referrer_host");
		expect(rows).toEqual([{ value: "", views: 2, visitors: 1 }]);
	});

	test("sites are listed with their activity", () => {
		db.analytics.insert([event({ site: "demo" }), event({ site: "other" })]);
		const sites = db.analytics.listSites().map((s) => s.site);
		expect(sites.sort()).toEqual(["demo", "other"]);
	});

	test("realtime counts recently-active sessions, not day-stable visitors", () => {
		const now = Date.now();
		db.analytics.insert([
			event({ session_id: "live", created_at: now - 60_000 }),
			event({ session_id: "stale", created_at: now - 3 * 3_600_000 }),
		]);
		const rt = db.analytics.realtime("demo", 5 * 60_000, now);
		expect(rt.active_sessions).toBe(1);
	});

	test("storeRaw=false keeps rollups working without raw rows", () => {
		db.analytics.insert([event(), event({ visitor_id: "v2" })], undefined, false);
		expect(db.analytics.select<{ n: number }>("SELECT COUNT(*) AS n FROM events")[0]!.n).toBe(0);
		const o = db.analytics.overview(range());
		expect(o.views).toBe(2);
		expect(o.visitors).toBe(2);
	});

	test("insert of an empty batch is a no-op", () => {
		expect(() => db.analytics.insert([])).not.toThrow();
		expect(db.analytics.stats().events).toBe(0);
	});
});

// ─── Retention ──────────────────────────────────────────────────

describe("analytics retention", () => {
	let dbPath: string;
	let db: RelogDatabase;

	beforeEach(() => {
		dbPath = tmpPath("retention");
		db = new RelogDatabase(dbPath);
	});
	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("drops raw events past their horizon but keeps aggregates", () => {
		const now = Date.now();
		db.analytics.insert([
			event({ created_at: now - 200 * DAY_MS, session_id: "old" }),
			event({ created_at: now - 1 * DAY_MS, session_id: "new" }),
		]);

		const config: AnalyticsConfig = {
			enabled: true,
			rawRetentionDays: 90,
			aggregateRetentionDays: 730,
		};
		const result = pruneAnalyticsOnce(db, config, now);
		expect(result.rawDeleted).toBe(1);
		expect(db.analytics.stats().events).toBe(1);
		// Both hours are still summarized.
		expect(db.analytics.stats().rollups).toBe(2);
	});

	test("aggregates are never pruned ahead of the raw rows they back", () => {
		const now = Date.now();
		db.analytics.insert([event({ created_at: now - 100 * DAY_MS })]);
		// Nonsense config: aggregates shorter than raw. Aggregates must still win.
		pruneAnalyticsOnce(
			db,
			{ enabled: true, rawRetentionDays: 365, aggregateRetentionDays: 1 },
			now,
		);
		expect(db.analytics.stats().events).toBe(1);
		expect(db.analytics.stats().rollups).toBe(1);
	});
});

// ─── Tracker script ─────────────────────────────────────────────

describe("tracker script", () => {
	test("is syntactically valid JavaScript", () => {
		expect(() => new Function(TRACKER_SCRIPT)).not.toThrow();
	});

	test("stays small enough to ship on every page", () => {
		expect(TRACKER_SCRIPT.length).toBeLessThan(8000);
	});

	test("avoids preflight-triggering content types", () => {
		expect(TRACKER_SCRIPT).not.toContain("application/json");
		expect(TRACKER_SCRIPT).toContain("text/plain");
	});
});

// ─── HTTP surface ───────────────────────────────────────────────

const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function withServer(
	analytics: AnalyticsConfig | undefined,
	fn: (base: string, db: RelogDatabase) => Promise<void>,
	extra: Partial<ServerConfig> = {},
): Promise<void> {
	const dbPath = tmpPath("srv");
	// Own data directory: the JSON side-stores otherwise default to ~/.relog,
	// which would leak test state into the developer's real install.
	const dataDir = `${dbPath}-data`;
	const instance = await startServer({
		port: 0,
		dbPath,
		dataDir,
		analytics,
		...extra,
	});
	try {
		await fn(`http://localhost:${instance.server.port}`, instance.db);
	} finally {
		await instance.shutdown();
		cleanupDb(dbPath);
		rmSync(dataDir, { recursive: true, force: true });
	}
}

function collect(base: string, body: unknown, headers: Record<string, string> = {}) {
	return fetch(`${base}/collect`, {
		method: "POST",
		headers: { "Content-Type": "text/plain;charset=UTF-8", "User-Agent": CHROME_UA, ...headers },
		body: JSON.stringify(body),
	});
}

const pageview = (over: Record<string, unknown> = {}) => ({
	site: "demo",
	name: "pageview",
	session_id: "sess-1",
	hostname: "example.com",
	path: "/",
	...over,
});

describe("analytics HTTP endpoints", () => {
	test("are absent unless analytics is enabled", async () => {
		await withServer(undefined, async (base) => {
			expect((await fetch(`${base}/script.js`)).status).toBe(404);
			expect((await collect(base, pageview())).status).toBe(404);
			expect((await fetch(`${base}/analytics/sites`)).status).toBe(404);
		});
	});

	test("serve the tracker with a wildcard origin and an ETag", async () => {
		await withServer({ enabled: true }, async (base) => {
			const res = await fetch(`${base}/script.js`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("javascript");
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
			const etag = res.headers.get("etag")!;
			expect(etag).toBeTruthy();

			const cached = await fetch(`${base}/script.js`, { headers: { "If-None-Match": etag } });
			expect(cached.status).toBe(304);
		});
	});

	test("answer the preflight without requiring the cors setting", async () => {
		await withServer({ enabled: true }, async (base) => {
			const res = await fetch(`${base}/collect`, { method: "OPTIONS" });
			expect(res.status).toBe(204);
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
		});
	});

	test("record a pageview end to end", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			const res = await collect(base, pageview({ path: "/pricing?utm_source=hn" }));
			expect(res.status).toBe(204);

			const rows = db.analytics.select<{ path: string; browser: string; utm_source: string }>(
				"SELECT path, browser, utm_source FROM events",
			);
			expect(rows.length).toBe(1);
			expect(rows[0]!.path).toBe("/pricing");
			expect(rows[0]!.browser).toBe("Chrome");
			expect(rows[0]!.utm_source).toBe("hn");
		});
	});

	test("never persist the client-supplied visitor id", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			await collect(base, pageview({ visitor_id: "attacker-chosen" }));
			const rows = db.analytics.select<{ visitor_id: string }>("SELECT visitor_id FROM events");
			expect(rows[0]!.visitor_id).not.toBe("attacker-chosen");
			expect(rows[0]!.visitor_id).toHaveLength(32);
		});
	});

	test("drop bots by default and count them when asked", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			const res = await collect(base, pageview(), { "User-Agent": "Googlebot/2.1" });
			expect(res.status).toBe(202);
			expect(db.analytics.stats().events).toBe(0);
		});

		await withServer({ enabled: true, includeBots: true }, async (base, db) => {
			await collect(base, pageview(), { "User-Agent": "Googlebot/2.1" });
			expect(db.analytics.stats().events).toBe(1);
		});
	});

	test("honour DNT only when configured to", async () => {
		await withServer({ enabled: true, respectDnt: true }, async (base, db) => {
			expect((await collect(base, pageview(), { DNT: "1" })).status).toBe(202);
			expect(db.analytics.stats().events).toBe(0);
		});
		await withServer({ enabled: true }, async (base, db) => {
			await collect(base, pageview(), { DNT: "1" });
			expect(db.analytics.stats().events).toBe(1);
		});
	});

	test("reject sites outside the allowlist", async () => {
		await withServer({ enabled: true, sites: ["demo"] }, async (base, db) => {
			expect((await collect(base, pageview({ site: "demo" }))).status).toBe(204);
			expect((await collect(base, pageview({ site: "someone-elses" }))).status).toBe(403);
			expect(db.analytics.stats().events).toBe(1);
		});
	});

	test("validate the payload shape", async () => {
		await withServer({ enabled: true }, async (base) => {
			expect((await collect(base, { name: "pageview", session_id: "s" })).status).toBe(400);
			expect((await collect(base, pageview({ site: "../etc/passwd" }))).status).toBe(400);
			expect((await collect(base, pageview({ session_id: undefined }))).status).toBe(400);
			expect((await collect(base, [])).status).toBe(400);
			expect(
				(
					await collect(
						base,
						Array.from({ length: 200 }, () => pageview()),
					)
				).status,
			).toBe(400);

			const bad = await fetch(`${base}/collect`, {
				method: "POST",
				headers: { "User-Agent": CHROME_UA },
				body: "{not json",
			});
			expect(bad.status).toBe(400);
		});
	});

	test("clamp implausible client timestamps to server time", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			const future = Date.now() + 10 * 365 * DAY_MS;
			await collect(base, pageview({ ts: future }));
			const rows = db.analytics.select<{ created_at: number }>("SELECT created_at FROM events");
			expect(rows[0]!.created_at).toBeLessThan(Date.now() + 60_000);
		});
	});

	test("redact secrets that arrive in custom event props", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			await collect(
				base,
				pageview({ name: "signup", props: { plan: "pro", api_key: "sk-live-123" } }),
			);
			const rows = db.analytics.select<{ props: string }>("SELECT props FROM events");
			const props = JSON.parse(rows[0]!.props);
			expect(props.plan).toBe("pro");
			expect(props.api_key).toBe("[REDACTED]");
		});
	});

	test("ignore geo headers when the proxy is untrusted", async () => {
		await withServer({ enabled: true }, async (base, db) => {
			await collect(base, pageview(), { "CF-IPCountry": "DE" });
			const rows = db.analytics.select<{ country: string | null }>("SELECT country FROM events");
			expect(rows[0]!.country).toBeNull();
		});

		await withServer(
			{ enabled: true },
			async (base, db) => {
				await collect(base, pageview(), { "CF-IPCountry": "DE" });
				const rows = db.analytics.select<{ country: string | null }>("SELECT country FROM events");
				expect(rows[0]!.country).toBe("DE");
			},
			{ trustProxy: true },
		);
	});

	test("serve the read API", async () => {
		await withServer({ enabled: true }, async (base) => {
			await collect(base, pageview({ path: "/", session_id: "a" }));
			await collect(base, pageview({ path: "/pricing", session_id: "a" }));

			const overview = await (await fetch(`${base}/analytics/overview?site=demo`)).json();
			expect(overview.views).toBe(2);
			expect(overview.sessions).toBe(1);

			const series = await (
				await fetch(`${base}/analytics/timeseries?site=demo&period=24h`)
			).json();
			expect(series.unit).toBe("hour");
			expect(series.points.reduce((n: number, p: { views: number }) => n + p.views, 0)).toBe(2);

			const breakdown = await (
				await fetch(`${base}/analytics/breakdown?site=demo&dimension=path`)
			).json();
			expect(breakdown.rows.map((r: { value: string }) => r.value).sort()).toEqual([
				"/",
				"/pricing",
			]);

			const realtime = await (await fetch(`${base}/analytics/realtime?site=demo`)).json();
			expect(realtime.active_sessions).toBe(1);

			const sites = await (await fetch(`${base}/analytics/sites`)).json();
			expect(sites.sites[0]!.site).toBe("demo");
		});
	});

	test("reject bad read parameters instead of guessing", async () => {
		await withServer({ enabled: true }, async (base) => {
			expect((await fetch(`${base}/analytics/overview`)).status).toBe(400);
			expect((await fetch(`${base}/analytics/breakdown?site=demo&dimension=evil`)).status).toBe(
				400,
			);
			expect((await fetch(`${base}/analytics/timeseries?site=demo&period=nonsense`)).status).toBe(
				400,
			);
			expect((await fetch(`${base}/analytics/timeseries?site=demo&unit=week`)).status).toBe(400);
			expect((await fetch(`${base}/analytics/overview?site=demo&from=0`)).status).toBe(400);
			expect((await fetch(`${base}/analytics/nope?site=demo`)).status).toBe(404);
		});
	});

	test("gate the read API behind the read role while leaving collect open", async () => {
		await withServer(
			{ enabled: true },
			async (base) => {
				expect((await fetch(`${base}/analytics/sites`)).status).toBe(401);
				const ok = await fetch(`${base}/analytics/sites`, {
					headers: { Authorization: "Bearer read-key" },
				});
				expect(ok.status).toBe(200);
				// The tracker cannot hold a secret, so collect stays open by default.
				expect((await collect(base, pageview())).status).toBe(204);
			},
			{ readKeys: ["read-key"] },
		);
	});

	test("requireKey closes the collect endpoint", async () => {
		await withServer(
			{ enabled: true, requireKey: true },
			async (base) => {
				expect((await collect(base, pageview())).status).toBe(401);
				const ok = await collect(base, pageview(), { Authorization: "Bearer ingest-key" });
				expect(ok.status).toBe(204);
			},
			{ ingestKeys: ["ingest-key"] },
		);
	});

	test("rate limit collect per address", async () => {
		await withServer({ enabled: true, collectRpm: 2 }, async (base) => {
			expect((await collect(base, pageview())).status).toBe(204);
			expect((await collect(base, pageview())).status).toBe(204);
			const limited = await collect(base, pageview());
			expect(limited.status).toBe(429);
			expect(limited.headers.get("access-control-allow-origin")).toBe("*");
		});
	});

	test("expose the analytics tables to the SQL query endpoint", async () => {
		await withServer({ enabled: true }, async (base) => {
			await collect(base, pageview());
			const res = await fetch(`${base}/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sql: "SELECT site, name, path FROM events" }),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.rows[0]).toMatchObject({ site: "demo", name: "pageview", path: "/" });
		});
	});
});

describe("floorHour", () => {
	test("snaps to the hour boundary", () => {
		expect(floorHour(BASE_TIME + 59 * 60_000)).toBe(BASE_TIME);
		expect(floorHour(BASE_TIME)).toBe(BASE_TIME);
	});
});
