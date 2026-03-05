import { type Command, command, number, string } from "@drizzle-team/brocli";
import { authHeaders } from "./shared.ts";

const SERVICES = ["api-server", "worker", "scheduler", "gateway", "auth-service"];
const PROJECTS = ["webapp", "mobile-api", "internal-tools"];
const BRANCHES = ["main", "feature/user-auth", "fix/timeout-bug", "develop"];
const VERSIONS = ["1.0.0", "1.1.0", "1.2.3", "2.0.0-beta.1", "2.0.0"];
const DEPLOYMENT_IDS = ["deploy-abc123", "deploy-def456", "deploy-ghi789", "deploy-jkl012"];
const HOSTS = ["prod-1", "prod-2", "prod-3", "staging-1", "dev-local"];
const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const HTTP_PATHS = [
	"/api/users",
	"/api/orders",
	"/api/payments",
	"/api/auth/login",
	"/api/auth/signup",
	"/api/products",
	"/api/webhooks",
	"/api/health",
	"/api/uploads",
	"/api/notifications",
	"/api/search",
];
const USER_AGENTS = [
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/121.0",
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
	"PostmanRuntime/7.36.0",
	"axios/1.6.0",
];

const MESSAGES: Record<string, string[]> = {
	trace: [
		"Entering middleware chain",
		"Resolving dependency: UserService",
		"Cache lookup key=session:abc123",
		"SQL: SELECT * FROM users WHERE id = $1",
		"Middleware chain complete in 0.3ms",
	],
	debug: [
		"Cache hit for user:123",
		"Request payload validated",
		"JWT token decoded successfully",
		"WebSocket connection upgraded",
		"Rate limiter bucket refilled",
	],
	info: [
		"http_request",
		"User signup completed",
		"Background job enqueued: email.welcome",
		"Deployment started",
		"Database migration applied: 042_add_indexes",
		"OAuth callback processed",
		"File uploaded: report-q4.pdf (2.3MB)",
		"Webhook delivered",
		"checkout",
		"process_payment",
	],
	warn: [
		"Rate limit approaching: 580/600 rpm",
		"Slow query detected: 1200ms",
		"Retry attempt 2/3 for email delivery",
		"Disk usage at 82%",
		"Deprecated API version called: v1",
		"Connection pool near capacity: 45/50",
		"Stale cache entry evicted: user:456",
	],
	error: [
		"POST /api/payments 500 Internal Server Error",
		"Connection refused: redis://localhost:6379",
		"Job failed: email.welcome - TimeoutError",
		"Unhandled exception in request handler",
		"Database deadlock detected, retrying transaction",
		"S3 upload failed: AccessDenied",
		"JWT verification failed: token expired",
	],
	fatal: [
		"Database connection pool exhausted",
		"Out of memory: heap limit reached",
		"TLS certificate expired, cannot accept connections",
	],
};

const WIDE_EVENT_NAMES = ["http_request", "checkout", "process_payment"];

const LEVEL_WEIGHTS = [
	{ level: "trace", weight: 10 },
	{ level: "debug", weight: 20 },
	{ level: "info", weight: 45 },
	{ level: "warn", weight: 15 },
	{ level: "error", weight: 8 },
	{ level: "fatal", weight: 2 },
];

function weightedLevel(): string {
	const total = LEVEL_WEIGHTS.reduce((s, w) => s + w.weight, 0);
	let r = Math.random() * total;
	for (const { level, weight } of LEVEL_WEIGHTS) {
		r -= weight;
		if (r <= 0) return level;
	}
	return "info";
}

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

function hexId(len: number): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, len);
}

interface TraceContext {
	trace_id: string;
	span_id: string;
}

// Generate correlated trace groups — multiple spans sharing a trace_id
const activeTraces: TraceContext[] = [];

function getOrCreateTrace(): TraceContext {
	// 40% chance to reuse an existing trace (creates correlated spans)
	if (activeTraces.length > 0 && Math.random() < 0.4) {
		const trace = pick(activeTraces);
		return { trace_id: trace.trace_id, span_id: hexId(16) };
	}
	// New trace
	const ctx: TraceContext = { trace_id: hexId(32), span_id: hexId(16) };
	activeTraces.push(ctx);
	// Keep pool bounded
	if (activeTraces.length > 20) activeTraces.shift();
	return ctx;
}

function randomMeta(level: string, message: string): Record<string, unknown> {
	const meta: Record<string, unknown> = {};

	// Wide event metadata for http_request / checkout / process_payment
	const isWideEvent = WIDE_EVENT_NAMES.includes(message);
	if (isWideEvent) {
		meta.event = true;
		meta.duration_ms = Math.round(Math.random() * 2000);
		meta.http_method = pick(HTTP_METHODS);
		meta.http_path = pick(HTTP_PATHS);
		meta.http_status = pick([200, 200, 200, 201, 204, 301, 400, 401, 403, 404, 500, 502]);
		meta.user_agent = pick(USER_AGENTS);
		if (Math.random() > 0.3) meta.user_id = `usr_${Math.floor(Math.random() * 10000)}`;
		if (Math.random() > 0.5) meta.org_id = `org_${Math.floor(Math.random() * 500)}`;
		if (message === "checkout" || message === "process_payment") {
			meta.cart_items = Math.floor(Math.random() * 10) + 1;
			meta.amount = Number.parseFloat((Math.random() * 500 + 5).toFixed(2));
			meta.currency = pick(["USD", "EUR", "GBP"]);
		}
		if (Math.random() > 0.7) meta.response_size = Math.floor(Math.random() * 50000);
		// Tail sampling metadata
		if (Math.random() > 0.8) meta.sample_rate = pick([0.01, 0.05, 0.1, 0.25]);
	} else {
		if (Math.random() > 0.5) meta.duration_ms = Math.round(Math.random() * 2000);
		if (Math.random() > 0.6) meta.user_id = `usr_${Math.floor(Math.random() * 10000)}`;
		if (Math.random() > 0.7) meta.request_id = hexId(8);
		if (Math.random() > 0.8)
			meta.http_status = pick([200, 201, 301, 400, 401, 403, 404, 500, 502, 503]);
	}

	if (level === "error" || level === "fatal") {
		const errorNames = [
			"TypeError",
			"ConnectionError",
			"TimeoutError",
			"ValidationError",
			"AuthError",
		];
		meta.error = pick([
			"connection failed",
			"timeout exceeded",
			"invalid token",
			"permission denied",
			"null reference",
		]);
		meta.name = pick(errorNames);
		meta.stack = `${pick(errorNames)}: something went wrong\n    at handler (src/routes/api.ts:${Math.floor(Math.random() * 200)}:12)\n    at processRequest (src/server.ts:45:8)\n    at Server.handle (src/server.ts:12:5)`;
	}

	if (level === "warn" && Math.random() > 0.5) {
		meta.threshold = pick([500, 1000, 2000, 5000]);
		meta.current = Math.floor(Math.random() * 6000);
	}

	return meta;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const seedCommand: Command = command({
	name: "seed",
	desc: "Send fake log data for testing and development",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		count: number().desc("Number of logs to send (0 = infinite)").default(100),
		rate: number().desc("Logs per second").default(10),
		batchSize: number("batch-size").desc("Logs per batch request").default(10),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const infinite = opts.count === 0;
		const delayMs = (1000 / opts.rate) * opts.batchSize;
		let sent = 0;

		console.log(`Seeding ${infinite ? "∞" : opts.count} logs to ${opts.url} at ~${opts.rate}/s`);

		while (infinite || sent < opts.count) {
			const batchCount = infinite ? opts.batchSize : Math.min(opts.batchSize, opts.count - sent);

			const batch = Array.from({ length: batchCount }, () => {
				const level = weightedLevel();
				const messages = MESSAGES[level] ?? MESSAGES.info!;
				const message = pick(messages);
				const trace = getOrCreateTrace();

				return {
					level,
					message,
					service: pick(SERVICES),
					project: pick(PROJECTS),
					branch: pick(BRANCHES),
					version: pick(VERSIONS),
					deployment_id: pick(DEPLOYMENT_IDS),
					host: pick(HOSTS),
					pid: Math.floor(Math.random() * 50000) + 1000,
					trace_id: trace.trace_id,
					span_id: trace.span_id,
					meta: randomMeta(level, message),
				};
			});

			try {
				const res = await fetch(`${opts.url}/ingest`, {
					method: "POST",
					headers: authHeaders(opts.auth),
					body: JSON.stringify(batch),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					console.error(`Ingest failed: ${body.error ?? res.status}`);
					break;
				}
				sent += batchCount;
				if (!infinite) {
					process.stdout.write(`\r  ${sent}/${opts.count} logs sent`);
				} else {
					process.stdout.write(`\r  ${sent} logs sent`);
				}
			} catch (err) {
				console.error(`\nConnection error: ${(err as Error).message}`);
				break;
			}

			await sleep(delayMs);
		}

		console.log(`\nDone. Sent ${sent} logs.`);
	},
});
