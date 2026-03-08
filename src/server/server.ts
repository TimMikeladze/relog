import { RelogDatabase } from "../db/database.ts";
import { DuckDBReader } from "../db/duckdb.ts";
import type { ServerConfig } from "../types.ts";
import { type AuthKeys, type AuthResult, checkRole } from "./middleware/auth.ts";
import { handleArchive } from "./routes/archive.ts";
import { handleHealth } from "./routes/health.ts";
import { handleIngest } from "./routes/ingest.ts";
import { handleLogs } from "./routes/logs.ts";
import { handlePrune } from "./routes/prune.ts";
import { handleHistogram } from "./routes/histogram.ts";
import { handleQuery, handleQueryStream } from "./routes/query.ts";
import { StreamManager, handleStream } from "./routes/stream.ts";
import { AggregatesManager } from "./aggregates.ts";
import { handleAggregates } from "./routes/aggregates.ts";

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;
const DEFAULT_INGEST_RPM = 600;

class RateLimiter {
	private windowMs: number;
	private maxRequests: number;
	private requests: number[] = [];

	constructor(windowMs: number, maxRequests: number) {
		this.windowMs = windowMs;
		this.maxRequests = maxRequests;
	}

	check(): boolean {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		// Remove expired entries
		while (this.requests.length > 0 && this.requests[0]! < cutoff) {
			this.requests.shift();
		}
		if (this.requests.length >= this.maxRequests) {
			return false;
		}
		this.requests.push(now);
		return true;
	}

	get remaining(): number {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		while (this.requests.length > 0 && this.requests[0]! < cutoff) {
			this.requests.shift();
		}
		return Math.max(0, this.maxRequests - this.requests.length);
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
	shutdown: () => void;
	autoPruneTimer?: ReturnType<typeof setInterval>;
}

export async function startServer(config: ServerConfig): Promise<ServerInstance> {
	const db = new RelogDatabase(config.dbPath);
	const startTime = Date.now();
	const maxBody = config.maxBodySize ?? DEFAULT_MAX_BODY;
	const maxBatchSize = config.maxBatchSize ?? 1000;
	const streamManager = new StreamManager(db, config.streamDebounceMs);
	const aggregatesManager = new AggregatesManager();
	await aggregatesManager.init();
	const ingestLimiter = new RateLimiter(60_000, config.ingestRpm ?? DEFAULT_INGEST_RPM);

	const duckdb = new DuckDBReader(config.dbPath, config.archive);
	await duckdb.init();
	console.log("[relog.dev] DuckDB read engine initialized");
	if (config.archive) {
		console.log(
			`[relog.dev] DuckDB reading archived data from s3://${config.archive.bucket}/${config.archive.prefix ?? "logs"}`,
		);
	}

	const keys: AuthKeys = {
		ingestKeys: config.ingestKeys,
		readKeys: config.readKeys,
		adminKeys: config.adminKeys,
	};

	const server = Bun.serve({
		port: config.port,
		maxRequestBodySize: maxBody,
		async fetch(request) {
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

				if (method === "POST" && path === "/ingest") {
					auth = checkRole(request, "ingest", keys, prefixLen);
					if (auth.error) return auth.error;
					if (!ingestLimiter.check()) {
						response = Response.json(
							{ error: "Too many requests" },
							{
								status: 429,
								headers: { "Retry-After": "10" },
							},
						);
					} else {
						response = await handleIngest(request, db, maxBatchSize, auth.keyPrefix);
						if (response.status === 201) streamManager.notify();
					}
				} else if (method === "POST" && path === "/histogram") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleHistogram(request, duckdb);
				} else if (method === "POST" && path === "/query") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleQuery(request, duckdb);
				} else if (method === "POST" && path === "/query/stream") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleQueryStream(request, duckdb);
				} else if (method === "POST" && path === "/archive") {
					auth = checkRole(request, "admin", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleArchive(request, db, config.archive, duckdb);
				} else if (method === "POST" && path === "/prune") {
					auth = checkRole(request, "admin", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handlePrune(request, db);
				} else if (method === "GET" && path === "/logs") {
					auth = checkRole(request, "read", keys, prefixLen);
					if (auth.error) return auth.error;
					response = await handleLogs(request, duckdb);
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
					response = await handleAggregates(request, aggregatesManager);
				} else {
					response = Response.json({ error: "Not found" }, { status: 404 });
				}

				if (config.cors) {
					for (const [k, v] of Object.entries(cors)) {
						response.headers.set(k, v);
					}
				}

				return response;
			} catch {
				return Response.json({ error: "Internal server error" }, { status: 500, headers: cors });
			}
		},
	});

	let autoPruneTimer: ReturnType<typeof setInterval> | undefined;

	if (config.autoPrune) {
		const { maxDbSize, maxAgeDays, intervalSeconds = 60 } = config.autoPrune;
		if (maxDbSize || maxAgeDays) {
			autoPruneTimer = setInterval(() => {
				try {
					let deleted = 0;
					if (maxAgeDays) {
						const cutoff = Date.now() - maxAgeDays * 86_400_000;
						deleted += db.prune(cutoff);
					}
					if (maxDbSize && db.getDbSize() > maxDbSize) {
						// Delete oldest 10% of logs by count to bring size down
						const count = db.getLogCount();
						const target = Math.max(Math.floor(count * 0.1), 1000);
						const oldest = db.pruneOldest(target);
						deleted += oldest;
					}
					if (deleted > 0) {
						console.log(`[relog.dev] auto-prune: deleted ${deleted} logs`);
					}
				} catch (err) {
					console.error("[relog.dev] auto-prune error:", err);
				}
			}, intervalSeconds * 1000);
		}
	}

	const shutdown = () => {
		if (autoPruneTimer) clearInterval(autoPruneTimer);
		streamManager.shutdown();
		server.stop();
		duckdb?.close();
		db.close();
	};

	return { server, db, duckdb, streamManager, aggregatesManager, shutdown, autoPruneTimer };
}
