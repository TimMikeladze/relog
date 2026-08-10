/**
 * Server-side enrichment for analytics events.
 *
 * Everything here runs on the collect path, not in the browser. That is
 * deliberate: the client is untrusted (a tracker payload can claim any
 * country, any device, any referrer), and the two inputs that matter most —
 * the IP address and the raw User-Agent — must never be persisted. They are
 * consumed here to derive coarse dimensions and then dropped.
 */

// ── Bot detection ──────────────────────────────────────────────────

/**
 * Substring match on a lowercased UA. Deliberately broad: a false positive
 * loses one pageview, a false negative permanently inflates every number on
 * the dashboard. Ordered roughly by hit frequency.
 */
const BOT_PATTERNS = [
	"bot",
	"crawler",
	"spider",
	"crawl",
	"slurp",
	"headless",
	"phantomjs",
	"puppeteer",
	"playwright",
	"selenium",
	"webdriver",
	"lighthouse",
	"pagespeed",
	"gtmetrix",
	"pingdom",
	"uptime",
	"monitor",
	"curl/",
	"wget",
	"python-requests",
	"python-urllib",
	"go-http-client",
	"java/",
	"okhttp",
	"axios/",
	"node-fetch",
	"got (",
	"httpie",
	"libwww",
	"scrapy",
	"apache-httpclient",
	"facebookexternalhit",
	"whatsapp",
	"telegrambot",
	"slackbot",
	"discordbot",
	"twitterbot",
	"linkedinbot",
	"embedly",
	"quora link preview",
	"outbrain",
	"pinterest",
	"vkshare",
	"preview",
	"fetcher",
	"feedfetcher",
	"archiver",
	"validator",
	"chatgpt",
	"gptbot",
	"claudebot",
	"anthropic",
	"perplexity",
	"ccbot",
	"bytespider",
	"amazonbot",
	"applebot",
	"petalbot",
	"semrush",
	"ahrefs",
	"mj12",
	"dotbot",
	"dataprovider",
	"seokicks",
];

export function isBot(userAgent: string | null | undefined): boolean {
	if (!userAgent) return true; // no UA at all is a script, not a browser
	const ua = userAgent.toLowerCase();
	for (const p of BOT_PATTERNS) {
		if (ua.includes(p)) return true;
	}
	return false;
}

// ── User-Agent parsing ─────────────────────────────────────────────

export type DeviceType = "desktop" | "mobile" | "tablet";

export interface ParsedUserAgent {
	browser: string;
	os: string;
	device: DeviceType;
}

/**
 * Order matters throughout: nearly every browser lies about being every
 * other browser. Edge claims Chrome and Safari, Chrome claims Safari, Opera
 * claims Chrome. Test the most-specific token first and stop.
 */
const BROWSER_RULES: [RegExp, string][] = [
	[/\bedg(?:e|a|ios)?\//i, "Edge"],
	[/\bopr\/|\bopera\b/i, "Opera"],
	[/\bvivaldi\//i, "Vivaldi"],
	[/\bbrave\//i, "Brave"],
	[/\byabrowser\//i, "Yandex"],
	[/\bsamsungbrowser\//i, "Samsung Internet"],
	[/\bucbrowser\//i, "UC Browser"],
	[/\bduckduckgo\//i, "DuckDuckGo"],
	[/\bfxios\//i, "Firefox"],
	[/\bfirefox\//i, "Firefox"],
	[/\bcrios\//i, "Chrome"],
	[/\bchrome\//i, "Chrome"],
	[/\bchromium\//i, "Chrome"],
	[/\bsafari\//i, "Safari"],
	[/\bmsie |\btrident\//i, "Internet Explorer"],
];

const OS_RULES: [RegExp, string][] = [
	// Windows Phone must precede Windows; Android must precede Linux.
	[/windows phone/i, "Windows Phone"],
	[/windows nt|win32|win64/i, "Windows"],
	[/android/i, "Android"],
	[/\bcros\b/i, "ChromeOS"],
	// iPadOS 13+ reports "Macintosh" — resolved by the touch check below.
	[/iphone|ipod/i, "iOS"],
	[/ipad/i, "iPadOS"],
	[/mac os x|macintosh/i, "macOS"],
	[/ubuntu/i, "Ubuntu"],
	[/\blinux\b|x11/i, "Linux"],
	[/freebsd|openbsd|netbsd/i, "BSD"],
];

const TABLET_RE = /ipad|\btablet\b|playbook|silk|(android(?!.*\bmobile\b))/i;
const MOBILE_RE = /mobi|iphone|ipod|android|blackberry|windows phone|opera mini|iemobile/i;

/**
 * Desktop Safari and iPadOS Safari are byte-identical in the UA string. The
 * only reliable signal is that iPadOS is touch-capable, which the tracker
 * reports separately. Without it, iPads silently count as macOS desktops.
 */
export function parseUserAgent(
	userAgent: string | null | undefined,
	hints?: { touch?: boolean; mobile?: boolean },
): ParsedUserAgent {
	const ua = userAgent ?? "";

	let browser = "Unknown";
	for (const [re, name] of BROWSER_RULES) {
		if (re.test(ua)) {
			browser = name;
			break;
		}
	}

	let os = "Unknown";
	for (const [re, name] of OS_RULES) {
		if (re.test(ua)) {
			os = name;
			break;
		}
	}

	let device: DeviceType;
	if (TABLET_RE.test(ua)) {
		device = "tablet";
	} else if (MOBILE_RE.test(ua) || hints?.mobile) {
		device = "mobile";
	} else if (os === "macOS" && hints?.touch) {
		// Macs are not touchscreens; this is an iPad masquerading as one.
		device = "tablet";
		os = "iPadOS";
	} else {
		device = "desktop";
	}

	return { browser, os, device };
}

// ── Referrer ───────────────────────────────────────────────────────

export interface ParsedReferrer {
	host: string | null;
	path: string | null;
}

/**
 * Internal navigation is not a referral. Comparing bare hostnames (rather
 * than full origins) also collapses http/https and port differences, which
 * would otherwise show a site referring itself on every local click.
 */
export function parseReferrer(
	referrer: string | null | undefined,
	selfHostname?: string | null,
): ParsedReferrer {
	if (!referrer) return { host: null, path: null };
	let url: URL;
	try {
		url = new URL(referrer);
	} catch {
		return { host: null, path: null };
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { host: null, path: null };
	}
	const host = stripWww(url.hostname.toLowerCase());
	if (selfHostname && host === stripWww(selfHostname.toLowerCase())) {
		return { host: null, path: null };
	}
	const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "") || "/";
	return { host, path: path.slice(0, 512) };
}

function stripWww(host: string): string {
	return host.startsWith("www.") ? host.slice(4) : host;
}

// ── UTM ────────────────────────────────────────────────────────────

export interface Utm {
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	utm_term: string | null;
	utm_content: string | null;
}

const EMPTY_UTM: Utm = {
	utm_source: null,
	utm_medium: null,
	utm_campaign: null,
	utm_term: null,
	utm_content: null,
};

const MAX_UTM_LENGTH = 255;

/**
 * Also maps the click-id params (`gclid`, `fbclid`, …) onto utm_source when
 * no explicit source is present — ad platforms frequently strip UTMs while
 * keeping their own click id, and those visits would otherwise land in
 * "direct" and make paid traffic look invisible.
 */
const CLICK_IDS: [string, string][] = [
	["gclid", "google"],
	["gbraid", "google"],
	["wbraid", "google"],
	["dclid", "google"],
	["msclkid", "bing"],
	["fbclid", "facebook"],
	["igshid", "instagram"],
	["ttclid", "tiktok"],
	["twclid", "twitter"],
	["li_fat_id", "linkedin"],
	["epik", "pinterest"],
	["irclickid", "impact"],
];

export function parseUtm(search: string | null | undefined): Utm {
	if (!search) return { ...EMPTY_UTM };
	let params: URLSearchParams;
	try {
		params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
	} catch {
		return { ...EMPTY_UTM };
	}
	const pick = (k: string): string | null => {
		const v = params.get(k);
		if (!v) return null;
		const trimmed = v.trim().slice(0, MAX_UTM_LENGTH);
		return trimmed.length > 0 ? trimmed : null;
	};
	const utm: Utm = {
		utm_source: pick("utm_source") ?? pick("ref") ?? pick("source"),
		utm_medium: pick("utm_medium"),
		utm_campaign: pick("utm_campaign") ?? pick("campaign"),
		utm_term: pick("utm_term"),
		utm_content: pick("utm_content"),
	};
	if (!utm.utm_source) {
		for (const [param, source] of CLICK_IDS) {
			if (params.has(param)) {
				utm.utm_source = source;
				utm.utm_medium ??= "cpc";
				break;
			}
		}
	}
	return utm;
}

// ── Path normalization ─────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const HEX_RE = /^[0-9a-f]{16,}$/i;
// ULID / nanoid / cuid style opaque ids: long, mixed case or digit-bearing.
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{16,}$/;
const MAX_PATH_LENGTH = 512;
const MAX_PATH_SEGMENTS = 24;

/**
 * Collapses identifier segments to `:id`. Without this, every `/orders/8123`
 * is its own dimension value: the rollup table degenerates into one row per
 * pageview, and the "top pages" list becomes useless noise. The trade-off is
 * that genuinely distinct slugs which look like ids get merged — acceptable,
 * because unbounded dimension cardinality is the failure that kills the
 * whole store.
 */
export function normalizePath(pathname: string | null | undefined): string {
	if (!pathname) return "/";
	let p = pathname.split("?")[0]!.split("#")[0]!;
	if (!p.startsWith("/")) p = `/${p}`;
	// Trailing slash is not a distinct page.
	if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
	if (p === "/") return "/";

	const segments = p.split("/").slice(1);
	if (segments.length > MAX_PATH_SEGMENTS) {
		return `${segments
			.slice(0, MAX_PATH_SEGMENTS)
			.map(normalizeSegment)
			.map((s) => `/${s}`)
			.join("")}/...`;
	}
	const out = segments
		.map(normalizeSegment)
		.map((s) => `/${s}`)
		.join("");
	return out.slice(0, MAX_PATH_LENGTH) || "/";
}

function normalizeSegment(seg: string): string {
	if (seg.length === 0) return "";
	if (NUMERIC_RE.test(seg)) return ":id";
	if (UUID_RE.test(seg)) return ":uuid";
	if (HEX_RE.test(seg)) return ":hash";
	// Require a digit so human slugs like "getting-started-with-relog" survive.
	if (OPAQUE_ID_RE.test(seg) && /\d/.test(seg) && !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(seg)) {
		return ":id";
	}
	return seg.slice(0, 128);
}

// ── Geo ────────────────────────────────────────────────────────────

export interface Geo {
	country: string | null;
	region: string | null;
	city: string | null;
}

/**
 * Geo comes from the edge proxy, not from an IP database. relog ships as a
 * single binary with no bundled GeoIP data, and every platform it realistically
 * runs behind (Cloudflare, Vercel, Fly, CloudFront) already resolves this and
 * passes it as a header. Reading it here costs nothing and stays accurate.
 *
 * Only trusted when `trustProxy` is set — otherwise any client can forge its
 * own country by setting the header directly.
 */
export function parseGeo(headers: Headers, trustProxy: boolean): Geo {
	if (!trustProxy) return { country: null, region: null, city: null };
	const country =
		headers.get("cf-ipcountry") ??
		headers.get("x-vercel-ip-country") ??
		headers.get("cloudfront-viewer-country") ??
		headers.get("x-country-code") ??
		null;
	const region =
		headers.get("x-vercel-ip-country-region") ??
		headers.get("cloudfront-viewer-country-region") ??
		headers.get("cf-region-code") ??
		null;
	const city =
		decodeHeader(headers.get("x-vercel-ip-city")) ??
		headers.get("cloudfront-viewer-city") ??
		headers.get("cf-ipcity") ??
		null;
	return {
		country: normalizeCountry(country),
		region: region ? region.slice(0, 8).toUpperCase() : null,
		city: city ? city.slice(0, 128) : null,
	};
}

/** Vercel percent-encodes city names ("San%20Francisco"). */
function decodeHeader(v: string | null): string | null {
	if (!v) return null;
	try {
		return decodeURIComponent(v);
	} catch {
		return v;
	}
}

function normalizeCountry(c: string | null): string | null {
	if (!c) return null;
	const up = c.trim().toUpperCase();
	// Cloudflare uses XX for unknown and T1 for Tor exit nodes.
	if (up.length !== 2 || up === "XX" || up === "T1") return null;
	return up;
}

// ── Client IP ──────────────────────────────────────────────────────

/**
 * The IP is used only as an input to the visitor hash and is never stored.
 * `x-forwarded-for` is attacker-controlled unless a proxy is known to be in
 * front, so it is only read when explicitly trusted; otherwise a client could
 * rotate the header per request and appear as unlimited unique visitors.
 */
export function clientIp(
	headers: Headers,
	socketAddress: string | null | undefined,
	trustProxy: boolean,
): string {
	if (trustProxy) {
		const forwarded =
			headers.get("cf-connecting-ip") ??
			headers.get("fly-client-ip") ??
			headers.get("true-client-ip") ??
			headers.get("x-real-ip");
		if (forwarded) return forwarded.trim();
		const xff = headers.get("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
	}
	return socketAddress ?? "0.0.0.0";
}
