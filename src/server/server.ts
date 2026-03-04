import { RelogDatabase } from "../db/database.ts";
import type { ServerConfig } from "../types.ts";
import { checkAuth } from "./middleware/auth.ts";
import { handleHealth } from "./routes/health.ts";
import { handleIngest } from "./routes/ingest.ts";
import { handleLogs } from "./routes/logs.ts";
import { handlePrune } from "./routes/prune.ts";
import { handleQuery, handleQueryStream } from "./routes/query.ts";
import { StreamManager, handleStream } from "./routes/stream.ts";

const DEFAULT_MAX_BODY = 5 * 1024 * 1024;

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
	streamManager: StreamManager;
	shutdown: () => void;
}

export function startServer(config: ServerConfig): ServerInstance {
	const db = new RelogDatabase(config.dbPath);
	const startTime = Date.now();
	const maxBody = config.maxBodySize ?? DEFAULT_MAX_BODY;
	const maxBatchSize = config.maxBatchSize ?? 1000;
	const streamManager = new StreamManager(db, config.streamDebounceMs);

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

				const authError = checkAuth(request, config.auth);
				if (authError) return authError;

				const url = new URL(request.url);
				const path = url.pathname;
				const method = request.method;

				let response: Response;

				if (method === "POST" && path === "/ingest") {
					response = await handleIngest(request, db, maxBatchSize);
					if (response.status === 201) streamManager.notify();
				} else if (method === "POST" && path === "/query") {
					response = await handleQuery(request, db);
				} else if (method === "POST" && path === "/query/stream") {
					response = await handleQueryStream(request, db);
				} else if (method === "POST" && path === "/prune") {
					response = await handlePrune(request, db);
				} else if (method === "GET" && path === "/logs") {
					response = handleLogs(request, db);
				} else if (method === "GET" && path === "/stream") {
					response = handleStream(request, streamManager, db);
				} else if (method === "GET" && path === "/health") {
					response = handleHealth(db, startTime);
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

	const shutdown = () => {
		streamManager.shutdown();
		server.stop();
		db.close();
	};

	return { server, db, streamManager, shutdown };
}
