import { join, resolve } from "node:path";
import { RelogDatabase } from "../db/database.ts";
import { DuckDBReader } from "../db/duckdb.ts";
import { getAggregatesPath, getWidgetsPath } from "../paths.ts";
import { type PruneHandle, startAutoPrune } from "../pruner.ts";
import { type SourcesHandle, startSources } from "../sources/runner.ts";
import { loadSourcesConfig } from "../sources/config.ts";
import type { ServerConfig } from "../types.ts";
import { type AuthKeys, type AuthResult, checkRole } from "./middleware/auth.ts";
import { handleHealth } from "./routes/health.ts";
import { handleIngest } from "./routes/ingest.ts";
import { handleLogs } from "./routes/logs.ts";
import { handleTraces } from "./routes/traces.ts";
import { handlePrune } from "./routes/prune.ts";
import { handleHistogram } from "./routes/histogram.ts";
import { handleQuery, handleQueryStream } from "./routes/query.ts";
import { StreamManager, handleStream } from "./routes/stream.ts";
import { AggregatesManager } from "./aggregates.ts";
import { handleAggregates } from "./routes/aggregates.ts";
import { WidgetsManager } from "./widgets.ts";
import { handleWidgets } from "./routes/widgets.ts";
import { handleOtelTraces, handleOtelLogs } from "./routes/otel.ts";
import { handleCollect } from "./routes/collect.ts";
import { handleAnalytics, handleTrackerScript } from "./routes/analytics.ts";
import { type AnalyticsPruneHandle, startAnalyticsPrune } from "../analytics/retention.ts";
import { IdempotencyStore } from "./idempotency.ts";

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const DEFAULT_INGEST_RPM = 600;
const DEFAULT_COLLECT_RPM = 600;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Retry-After must reflect the actual rate-limit window. Hardcoding "10" while
// the window is 60s causes well-behaved clients to thunder back at 10s and
// repeatedly hit the limiter, amplifying load instead of relieving it.
const RATE_LIMIT_RETRY_AFTER = String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));

class RateLimiter {
	private windowMs: number;
	private maxRequests: number;
	private requests: number[] = [];
	private head = 0;

	constructor(windowMs: number, maxRequests: number) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
	}

	private evict(now: number): void {
		const cutoff = now - this.windowMs;
		while (this.head < this.requests.length && this.requests[this.head]! < cutoff) {
			this.head++;
		}
		// Compact when over half the array is dead entries
		if (this.head > this.requests.length / 2) {
			this.requests = this.requests.slice(this.head);
			this.head = 0;
		}
	}

	private get active(): number {
		return this.requests.length - this.head;
	}

	check(): boolean {
		const now = Date.now();
		this.evict(now);
		if (this.active >= this.maxRequests) {
			return false;
		}
		this.requests.push(now);
		return true;
	}

	get remaining(): number {
		this.evict(Date.now());
		return Math.max(0, this.maxRequests - this.active);
	}

	/** Last activity timestamp; used by the per-key map to GC idle entries. */
	get lastSeen(): number {
		return this.requests[this.requests.length - 1] ?? 0;
	}
}

/**
 * Per-key rate limit so one noisy ingest key cannot starve others. The
 * unauthenticated case (no keys configured at all) shares a single
 * "anonymous" bucket. Idle limiters are GC'd to bound map growth; otherwise
 * a flood of one-off bogus tokens could grow the map without bound, which
 * is itself a DoS vector.
 */
class PerKeyRateLimiter {
	private buckets = new Map<string, RateLimiter>();
	private windowMs: number;
	private maxRequests: number;
	private lastGcAt = 0;
	private readonly GC_INTERVAL_MS = 5 * 60_000;
	private readonly IDLE_TTL_MS = 10 * 60_000;
	private readonly ANON_KEY = "__anon__";

	constructor(windowMs: number, maxRequests: number) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
	}

	check(keyPrefix: string | undefined): boolean {
		this.maybeGc();
		const k = keyPrefix && keyPrefix.length > 0 ? keyPrefix : this.ANON_KEY;
		let limiter = this.buckets.get(k);
		if (!limiter) {
			limiter = new RateLimiter(this.windowMs, this.maxRequests);
			this.buckets.set(k, limiter);
		}
		return limiter.check();
	}

	private maybeGc(): void {
		const now = Date.now();
		if (now - this.lastGcAt < this.GC_INTERVAL_MS) return;
		this.lastGcAt = now;
		const cutoff = now - this.IDLE_TTL_MS;
		for (const [k, limiter] of this.buckets) {
			if (limiter.lastSeen < cutoff) this.buckets.delete(k);
		}
	}
}

// Origins must be either "*" or http(s)://host[:port]. Anything else
// (javascript:, data:, file:, missing scheme) is rejected so a misconfig or
// malicious header value can't be reflected into Access-Control-Allow-Origin.
const VALID_ORIGIN_RE = /^https?:\/\/[^\s/]+$/;

function isValidOrigin(origin: string): boolean {
	return origin === "*" || VALID_ORIGIN_RE.test(origin);
}

function resolveCorsOrigin(
	cors: ServerConfig["cors"],
	requestOrigin: string | null,
): string | null {
	if (!cors) return null;
	if (cors === true) return "*";
	if (typeof cors === "string") return isValidOrigin(cors) ? cors : null;
	if (Array.isArray(cors) && requestOrigin && cors.includes(requestOrigin)) {
		return isValidOrigin(requestOrigin) ? requestOrigin : null;
	}
	return null;
}

function validateCorsConfig(cors: ServerConfig["cors"]): void {
	if (!cors || cors === true) return;
	const list = typeof cors === "string" ? [cors] : cors;
	for (const o of list) {
		if (!isValidOrigin(o)) {
			throw new Error(
				`[relog.dev] Invalid CORS origin: ${JSON.stringify(o)}. Must be "*" or http(s)://host[:port].`,
			);
		}
	}
}

function corsHeaders(config: ServerConfig, requestOrigin: string | null): Record<string, string> {
	const origin = resolveCorsOrigin(config.cors, requestOrigin);
	if (!origin) return {};
	const headers: Record<string, string> = {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};
	if (origin !== "*") {
		headers["Vary"] = "Origin";
	}
	return headers;
}

export interface ServerInstance {
	server: ReturnType<typeof Bun.serve>;
	db: RelogDatabase;
	duckdb: DuckDBReader;
	streamManager: StreamManager;
	aggregatesManager: AggregatesManager;
	widgetsManager: WidgetsManager;
	shutdown: () => Promise<void>;
	pruneHandle?: PruneHandle;
	analyticsPruneHandle?: AnalyticsPruneHandle;
	sourcesHandle?: SourcesHandle;
}

export async function startServer(config: ServerConfig): Promise<ServerInstance> {
	const db = new RelogDatabase(config.dbPath);
	const startTime = Date.now();
	const maxBody = config.maxBodySize ?? DEFAULT_MAX_BODY;
	const maxBatchSize = config.maxBatchSize ?? 1000;
	const streamManager = new StreamManager(db, config.streamDebounceMs);
	const aggregatesManager = new AggregatesManager(getAggregatesPath());
	await aggregatesManager.init();
	const widgetsManager = new WidgetsManager(getWidgetsPath());
	await widgetsManager.init();
	const ingestLimiter = new PerKeyRateLimiter(
		RATE_LIMIT_WINDOW_MS,
		config.ingestRpm ?? DEFAULT_INGEST_RPM,
	);
	const idempotency = new IdempotencyStore();

	// /health is unauthenticated and cheap, but unbounded. A bot scanning
	// for /health endpoints can fill logs quickly. Bucket per remote IP so a
	// single misbehaving probe can't starve real load-balancer probes.
	// Trust `x-forwarded-for` first (front a reverse proxy in prod);
	// otherwise fall back to the socket peer address.
	const healthLimiter = new PerKeyRateLimiter(RATE_LIMIT_WINDOW_MS, 60);

	// /collect is reachable by anonymous browsers by design, so it gets its own
	// per-IP bucket rather than sharing the per-key ingest limiter — otherwise
	// one visitor's tab could exhaust the budget for every application shipping
	// logs through the same key.
	const analytics = config.analytics;
	const collectLimiter = new PerKeyRateLimiter(
		RATE_LIMIT_WINDOW_MS,
		analytics?.collectRpm ?? DEFAULT_COLLECT_RPM,
	);
	if (analytics?.enabled && (!analytics.sites || analytics.sites.length === 0)) {
		console.warn(
			"[relog.dev] Analytics is enabled with no `sites` allowlist. /collect will accept events for any site id — set `analytics.sites` in production.",
		);
	}

	validateCorsConfig(config.cors);
	if (config.cors === true) {
		console.warn(
			"[relog.dev] CORS is configured as `true` (wildcard `*`). Do NOT use this in production — set `cors` to a specific origin or list of origins.",
		);
	}

	const duckdb = new DuckDBReader(config.dbPath, config.archive);
	await duckdb.init();
	console.log("[relog.dev] DuckDB read engine initialized");
	if (config.archive) {
		console.log(
			`[relog.dev] DuckDB reading archived data from s3://${config.archive.bucket}/${config.archive.prefix ?? "logs"}`,
		);
	}

	// Load source configs before starting the HTTP server so a config
	// error doesn't leak a running server or pruner
	const sourceConfigs = config.sourcesConfigPath
		? loadSourcesConfig(config.sourcesConfigPath)
		: undefined;

	const keys: AuthKeys = {
		ingestKeys: config.ingestKeys,
		readKeys: config.readKeys,
		adminKeys: config.adminKeys,
	};

	const server = Bun.serve({
		port: config.port,
		maxRequestBodySize: maxBody,
		idleTimeout: config.idleTimeout ?? 60,
		async fetch(request, server) {
			const requestOrigin = request.headers.get("Origin");
			const cors = corsHeaders(config, requestOrigin);

			try {
				if (request.method === "OPTIONS" && config.cors) {
					return new Response(null, { status: 204, headers: cors });
				}

				const url = new URL(request.url);
				const path = url.pathname;
				const method = request.method;

				// Only trust XFF when configured. Otherwise it is attacker-controlled
				// and lets a single client spoof per-IP rate-limit buckets.
				const socketAddress = () => server.requestIP(request)?.address ?? null;
				const remoteAddress = (): string => {
					const xff = config.trustProxy ? request.headers.get("x-forwarded-for") : null;
					return xff?.split(",")[0]?.trim() || socketAddress() || "_anon";
				};

				// The tracker runs on other people's sites, so the analytics
				// endpoints must answer cross-origin regardless of the `cors`
				// setting, which governs the authenticated read/ingest API. Both
				// are anonymous, credential-free and rate-limited, so a wildcard
				// here grants nothing that a plain HTTP client did not already have.
				const isPublicAnalyticsPath = path === "/collect" || path === "/script.js";
				if (analytics?.enabled && isPublicAnalyticsPath && method === "OPTIONS") {
					return new Response(null, {
						status: 204,
						headers: {
							"Access-Control-Allow-Origin": "*",
							"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
							"Access-Control-Allow-Headers": "Content-Type",
							"Access-Control-Max-Age": "86400",
						},
					});
				}

				if (analytics?.enabled && method === "GET" && path === "/script.js") {
					const response = handleTrackerScript(request);
					response.headers.set("Access-Control-Allow-Origin", "*");
					return response;
				}

				if (analytics?.enabled && method === "POST" && path === "/collect") {
					// A public collect endpoint keyed by anything the client controls
					// is trivially bypassed, so the bucket is the remote address.
					if (!collectLimiter.check(remoteAddress())) {
						return new Response(null, {
							status: 429,
							headers: {
								"Retry-After": RATE_LIMIT_RETRY_AFTER,
								"Access-Control-Allow-Origin": "*",
							},
						});
					}
					let collectKeyPrefix: string | undefined;
					if (analytics.requireKey) {
						const auth = checkRole(request, "ingest", keys, config.keyPrefixLength ?? 6);
						if (auth.error) {
							auth.error.headers.set("Access-Control-Allow-Origin", "*");
							return auth.error;
						}
						collectKeyPrefix = auth.keyPrefix;
					}
					const response = await handleCollect(request, db, {
						config: analytics,
						trustProxy: config.trustProxy === true,
						socketAddress: socketAddress(),
						keyPrefix: collectKeyPrefix,
					});
					response.headers.set("Access-Control-Allow-Origin", "*");
					return response;
				}

				// Health check before auth so load balancers can probe without credentials
				if (method === "GET" && path === "/health") {
					const remoteIp = remoteAddress();
					if (!healthLimiter.check(remoteIp)) {
						return Response.json(
							{ error: "Too many requests" },
							{ status: 429, headers: { "Retry-After": RATE_LIMIT_RETRY_AFTER, ...cors } },
						);
					}
					const response = handleHealth(db, startTime, config.autoPrune);
					if (config.cors) {
						for (const [k, v] of Object.entries(cors)) {
							response.headers.set(k, v);
						}
					}
					return response;
				}

				let response: Response;
				let auth: AuthResult;
				const prefixLen = config.keyPrefixLength ?? 6;

				if (method === "POST" && path === "/v1/traces") {
					auth = checkRole(request, "ingest", keys, prefixLen);
					if (auth.error) return auth.error;
					if (!ingestLimiter.check(auth.keyPrefix)) {
						response = Response.json(
							{ error: "Too many requests" },
							{ status: 429, headers: { "Retry-After": RATE_LIMIT_RETRY_AFTER } },
						);
					} else {
						response = await handleOtelTraces(
							request,
							db,
							maxBatchSize,
							auth.keyPrefix,
							idempotency,
						);
						if (response.status === 200) streamManager.notify();
					}
				} else if (method === "POST" && path === "/v1/metrics") {
					// OTel metrics not yet implemented. Auth-gate the response so the
					// endpoint can't be used to fingerprint the service unauthenticated;
					// authorized exporters still get a clear 501 instead of a 404.
					auth = checkRole(request, "ingest", keys, prefixLen);
					if (auth.error) return auth.error;
					response = Response.json(
						{ error: "OTLP metrics endpoint not implemented" },
						{ status: 501 },
					);
				} else if (method === "POST" && path === "/v1/logs") {
					auth = checkRole(request, "ingest", keys, prefixLen);
					if (auth.error) return auth.error;
					if (!ingestLimiter.check(auth.keyPrefix)) {
						response = Response.json(
							{ error: "Too many requests" },
							{ status: 429, headers: { "Retry-After": RATE_LIMIT_RETRY_AFTER } },
						);
					} else {
						response = await handleOtelLogs(request, db, maxBatchSize, auth.keyPrefix, idempotency);
						if (response.status === 200) streamManager.notify();
					}
				} else if (method === "POST" && path === "/ingest") {
					auth = checkRole(request, "ingest", keys, prefixLen);
					if (auth.error) return auth.error;
					if (!ingestLimiter.check(auth.keyPrefix)) {
						response = Response.json(
							{ error: "Too many requests" },
							{
								status: 429,
								headers: { "Retry-After": RATE_LIMIT_RETRY_AFTER },
							},
						);
					} else {
						response = await handleIngest(request, db, maxBatchSize, auth.keyPrefix, idempotency);
						if (response.status === 201) streamManager.notify();
					}
				} else if (method === "POST" && path === "/histogram") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleHistogram(request, duckdb, auth.keyPrefix);
				} else if (method === "POST" && path === "/query") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleQuery(request, duckdb, auth.keyPrefix);
				} else if (method === "POST" && path === "/query/stream") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleQueryStream(request, duckdb, auth.keyPrefix);
				} else if (method === "POST" && path === "/prune") {
					auth = checkRole(request, "admin", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handlePrune(request, db, auth.keyPrefix);
				} else if (method === "GET" && path === "/logs") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleLogs(request, duckdb, auth.keyPrefix);
				} else if (method === "GET" && path === "/traces") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleTraces(request, duckdb, auth.keyPrefix);
				} else if (method === "GET" && path === "/stream") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = handleStream(request, streamManager, db);
				} else if (path.startsWith("/aggregates")) {
					// Aggregates are read-accessible, write requires admin
					if (method === "GET") {
						auth = checkRole(request, "read", keys, prefixLen);
					} else {
						auth = checkRole(request, "admin", keys, prefixLen);
					}
					if (auth.error) return auth.error;
					response = await handleAggregates(request, aggregatesManager, auth.keyPrefix);
				} else if (method === "GET" && path.startsWith("/analytics/")) {
					if (!analytics?.enabled) {
						response = Response.json({ error: "Analytics is not enabled" }, { status: 404 });
					} else {
						auth = checkRole(request, "read", keys, prefixLen);
						if (auth.error) return auth.error;
						response = await handleAnalytics(request, db, auth.keyPrefix);
					}
				} else if (path.startsWith("/widgets")) {
					if (method === "GET") {
						auth = checkRole(request, "read", keys, prefixLen);
					} else {
						auth = checkRole(request, "admin", keys, prefixLen);
					}
					if (auth.error) return auth.error;
					response = await handleWidgets(request, widgetsManager, auth.keyPrefix);
				} else if (method === "GET" && config.uiDistPath) {
					// Serve the bundled web UI with SPA fallback
					// Prevent path traversal by resolving and checking the path stays within root
					const root = resolve(config.uiDistPath);
					const filePath = resolve(root, path === "/" ? "index.html" : `.${path}`);
					if (!filePath.startsWith(`${root}/`) && filePath !== root) {
						response = Response.json({ error: "Not found" }, { status: 404 });
					} else {
						const file = Bun.file(filePath);
						const exists = await file.exists();
						const served = exists ? file : Bun.file(join(root, "index.html"));
						// HTML must never be cached: the SPA shell holds references
						// to hashed JS/CSS bundles, so a stale index.html points at
						// 404'd assets after deploy. Hashed assets under /assets/
						// (Vite default) are content-addressed and safe to cache
						// indefinitely.
						const isHtml = !exists || filePath.endsWith(".html");
						const cacheControl = isHtml
							? "no-cache, no-store, must-revalidate"
							: filePath.includes("/assets/")
								? "public, max-age=31536000, immutable"
								: "public, max-age=3600";
						response = new Response(served, {
							headers: { "Cache-Control": cacheControl },
						});
					}
				} else {
					response = Response.json({ error: "Not found" }, { status: 404 });
				}

				if (config.cors) {
					for (const [k, v] of Object.entries(cors)) {
						response.headers.set(k, v);
					}
				}

				return response;
			} catch (err) {
				console.error("[relog.dev] Unhandled request error:", err);
				return Response.json({ error: "Internal server error" }, { status: 500, headers: cors });
			}
		},
	});

	const pruneHandle = config.autoPrune
		? startAutoPrune(db, config.autoPrune, config.archive, () => duckdb.refreshView())
		: undefined;

	const analyticsPruneHandle = analytics?.enabled ? startAnalyticsPrune(db, analytics) : undefined;

	let sourcesHandle: SourcesHandle | undefined;
	if (sourceConfigs && sourceConfigs.length > 0) {
		sourcesHandle = startSources(db, streamManager, sourceConfigs);
		console.log(`[relog.dev] ${sourceConfigs.length} source(s) configured`);
	}

	const shutdown = async () => {
		await sourcesHandle?.stop();
		pruneHandle?.stop();
		analyticsPruneHandle?.stop();
		streamManager.shutdown();
		// Stop accepting new connections, drain in-flight up to 5s, then force-close
		const drained = await Promise.race([
			server.stop().then(() => true),
			Bun.sleep(5000).then(() => false),
		]);
		if (!drained) {
			await server.stop(true);
		}
		duckdb?.close();
		db.close();
	};

	return {
		server,
		db,
		duckdb,
		streamManager,
		aggregatesManager,
		widgetsManager,
		shutdown,
		pruneHandle,
		analyticsPruneHandle,
		sourcesHandle,
	};
}
