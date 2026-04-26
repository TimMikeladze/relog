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
import { IdempotencyStore } from "./idempotency.ts";

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const DEFAULT_INGEST_RPM = 600;

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

function resolveCorsOrigin(
	cors: ServerConfig["cors"],
	requestOrigin: string | null,
): string | null {
	if (!cors) return null;
	if (cors === true) return "*";
	if (typeof cors === "string") return cors;
	if (Array.isArray(cors) && requestOrigin && cors.includes(requestOrigin)) {
		return requestOrigin;
	}
	return null;
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
	const ingestLimiter = new PerKeyRateLimiter(60_000, config.ingestRpm ?? DEFAULT_INGEST_RPM);
	const idempotency = new IdempotencyStore();

	// /health is unauthenticated and cheap, but unbounded. A bot scanning
	// for /health endpoints can fill logs quickly. Bucket per remote IP so a
	// single misbehaving probe can't starve real load-balancer probes.
	// Trust `x-forwarded-for` first (front a reverse proxy in prod);
	// otherwise fall back to the socket peer address.
	const healthLimiter = new PerKeyRateLimiter(60_000, 60);

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

				// Health check before auth so load balancers can probe without credentials
				if (method === "GET" && path === "/health") {
					const xff = request.headers.get("x-forwarded-for");
					const remoteIp =
						xff?.split(",")[0]?.trim() || server.requestIP(request)?.address || "_anon";
					if (!healthLimiter.check(remoteIp)) {
						return Response.json(
							{ error: "Too many requests" },
							{ status: 429, headers: { "Retry-After": "10", ...cors } },
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
							{ status: 429, headers: { "Retry-After": "10" } },
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
					// OTel metrics not yet implemented — respond explicitly so exporters
					// get a clear signal instead of a generic 404 that looks like a route typo.
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
							{ status: 429, headers: { "Retry-After": "10" } },
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
								headers: { "Retry-After": "10" },
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
						if (await file.exists()) {
							response = new Response(file);
						} else {
							response = new Response(Bun.file(join(root, "index.html")));
						}
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

	let sourcesHandle: SourcesHandle | undefined;
	if (sourceConfigs && sourceConfigs.length > 0) {
		sourcesHandle = startSources(db, streamManager, sourceConfigs);
		console.log(`[relog.dev] ${sourceConfigs.length} source(s) configured`);
	}

	const shutdown = async () => {
		await sourcesHandle?.stop();
		pruneHandle?.stop();
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
		sourcesHandle,
	};
}
