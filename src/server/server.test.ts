import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { startServer, type ServerInstance } from "./server.ts";

const TEST_DB = "test-e2e.db";
const TEST_PORT = 0; // random available port

let instance: ServerInstance;
let baseUrl: string;

const ADMIN_KEY = "test-admin-key";
const READ_KEY = "test-read-key";
const INGEST_KEY = "test-ingest-key";

function url(path: string): string {
	return `${baseUrl}${path}`;
}

function bearerHeaders(key: string = ADMIN_KEY): Record<string, string> {
	return {
		Authorization: `Bearer ${key}`,
	};
}

beforeAll(async () => {
	cleanup();
	instance = await startServer({
		port: TEST_PORT,
		dbPath: TEST_DB,
		adminKeys: [ADMIN_KEY],
		readKeys: [READ_KEY],
		ingestKeys: [INGEST_KEY],
		cors: true,
		streamDebounceMs: 10,
	});
	baseUrl = `http://localhost:${instance.server.port}`;
});

afterAll(() => {
	instance.shutdown();
	cleanup();
});

function cleanup() {
	for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
		try {
			unlinkSync(f);
		} catch {}
	}
}

// ── Auth ────────────────────────────────────────────────────────────────

describe("auth", () => {
	test("health is unauthenticated", async () => {
		const res = await fetch(url("/health"));
		expect(res.status).toBe(200);
	});

	test("rejects requests without auth", async () => {
		const res = await fetch(url("/logs"));
		expect(res.status).toBe(401);
	});

	test("rejects requests with wrong key", async () => {
		const res = await fetch(url("/logs"), {
			headers: bearerHeaders("wrong-key"),
		});
		expect(res.status).toBe(401);
	});

	test("accepts requests with admin key", async () => {
		const res = await fetch(url("/logs"), {
			headers: bearerHeaders(ADMIN_KEY),
		});
		expect(res.status).toBe(200);
	});

	test("accepts requests with read key for read routes", async () => {
		const res = await fetch(url("/logs"), {
			headers: bearerHeaders(READ_KEY),
		});
		expect(res.status).toBe(200);
	});

	test("ingest key can ingest but not read", async () => {
		const ingestRes = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(INGEST_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "ingest-role-test" }),
		});
		expect(ingestRes.status).toBe(201);

		const readRes = await fetch(url("/logs"), {
			headers: bearerHeaders(INGEST_KEY),
		});
		expect(readRes.status).toBe(403);
	});

	test("read key can ingest and read but not prune", async () => {
		const ingestRes = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(READ_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "read-role-ingest" }),
		});
		expect(ingestRes.status).toBe(201);

		const readRes = await fetch(url("/logs"), {
			headers: bearerHeaders(READ_KEY),
		});
		expect(readRes.status).toBe(200);

		const pruneRes = await fetch(url("/prune"), {
			method: "POST",
			headers: { ...bearerHeaders(READ_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ before: Date.now() }),
		});
		expect(pruneRes.status).toBe(403);
	});

	test("admin key can do everything", async () => {
		const ingestRes = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(ADMIN_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "admin-role-test" }),
		});
		expect(ingestRes.status).toBe(201);

		const readRes = await fetch(url("/logs"), {
			headers: bearerHeaders(ADMIN_KEY),
		});
		expect(readRes.status).toBe(200);

		const pruneRes = await fetch(url("/prune"), {
			method: "POST",
			headers: { ...bearerHeaders(ADMIN_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ before: 0 }),
		});
		expect(pruneRes.status).toBe(200);
	});
});

// ── CORS ────────────────────────────────────────────────────────────────

describe("cors", () => {
	test("OPTIONS returns 204 with CORS headers", async () => {
		const res = await fetch(url("/health"), {
			method: "OPTIONS",
			headers: { Origin: "http://example.com" },
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
	});

	test("response includes CORS headers", async () => {
		const res = await fetch(url("/health"), {
			headers: { ...bearerHeaders(), Origin: "http://example.com" },
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});
});

// ── Health ───────────────────────────────────────────────────────────────

describe("GET /health", () => {
	test("returns health status", async () => {
		const res = await fetch(url("/health"), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.uptime).toBe("number");
		expect(typeof body.db_size_bytes).toBe("number");
		expect(typeof body.log_count).toBe("number");
	});
});

// ── Ingest ──────────────────────────────────────────────────────────────

describe("POST /ingest", () => {
	test("ingests a single log entry", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				level: "info",
				message: "hello world",
				service: "test-svc",
				project: "my-project",
				branch: "main",
			}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ingested).toBe(1);
	});

	test("ingests a batch of entries", async () => {
		const entries = [
			{ level: "debug", message: "debug msg", service: "svc-a", project: "proj-1", branch: "feat" },
			{ level: "warn", message: "warn msg", service: "svc-b", meta: { key: "value" } },
			{ level: "error", message: "error msg", trace_id: "t-123", span_id: "s-456" },
		];
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(entries),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.ingested).toBe(3);
	});

	test("rejects invalid level", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "invalid", message: "test" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects missing message", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects empty array", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify([]),
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid JSON", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid meta type", async () => {
		const res = await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "test", meta: "string" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid field types", async () => {
		const cases = [
			{ level: "info", message: "test", service: 123 },
			{ level: "info", message: "test", pid: "not-a-number" },
			{ level: "info", message: "test", host: 456 },
			{ level: "info", message: "test", trace_id: 789 },
			{ level: "info", message: "test", span_id: 101 },
			{ level: "info", message: "test", project: 111 },
			{ level: "info", message: "test", branch: 222 },
			{ level: "info", message: "test", timestamp: 333 },
		];
		for (const c of cases) {
			const res = await fetch(url("/ingest"), {
				method: "POST",
				headers: { ...bearerHeaders(), "Content-Type": "application/json" },
				body: JSON.stringify(c),
			});
			expect(res.status).toBe(400);
		}
	});
});

// ── GET /logs ───────────────────────────────────────────────────────────

describe("GET /logs", () => {
	test("returns all logs", async () => {
		const res = await fetch(url("/logs"), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(4);
		expect(typeof body.total).toBe("number");
	});

	test("filters by level", async () => {
		const res = await fetch(url("/logs?level=error"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.level).toBe("error");
		}
	});

	test("filters by service", async () => {
		const res = await fetch(url("/logs?service=test-svc"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.service).toBe("test-svc");
		}
	});

	test("filters by project", async () => {
		const res = await fetch(url("/logs?project=my-project"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.project).toBe("my-project");
		}
	});

	test("filters by branch", async () => {
		const res = await fetch(url("/logs?branch=main"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.branch).toBe("main");
		}
	});

	test("filters by grep", async () => {
		const res = await fetch(url("/logs?grep=hello"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.message).toContain("hello");
		}
	});

	test("supports limit and offset", async () => {
		const res = await fetch(url("/logs?limit=2&offset=0"), { headers: bearerHeaders() });
		const body = await res.json();
		expect(body.rows.length).toBeLessThanOrEqual(2);
		expect(body.limit).toBe(2);
		expect(body.offset).toBe(0);
	});

	test("rejects invalid level", async () => {
		const res = await fetch(url("/logs?level=nope"), { headers: bearerHeaders() });
		expect(res.status).toBe(400);
	});

	test("rejects invalid limit", async () => {
		const res = await fetch(url("/logs?limit=-1"), { headers: bearerHeaders() });
		expect(res.status).toBe(400);
	});

	test("rejects invalid offset", async () => {
		const res = await fetch(url("/logs?offset=-1"), { headers: bearerHeaders() });
		expect(res.status).toBe(400);
	});

	test("filters by time range", async () => {
		const now = new Date().toISOString();
		const res = await fetch(url(`/logs?from=1h&to=${now}`), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.rows)).toBe(true);
	});
});

// ── POST /query ─────────────────────────────────────────────────────────

describe("POST /query", () => {
	test("executes a SELECT query", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT * FROM logs LIMIT 5" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.rows)).toBe(true);
		expect(typeof body.count).toBe("number");
		expect(typeof body.time_ms).toBe("number");
	});

	test("supports parameterized queries", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				sql: "SELECT * FROM logs WHERE level = ? LIMIT 10",
				params: ["info"],
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const row of body.rows) {
			expect(row.level).toBe("info");
		}
	});

	test("rejects write queries", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "DELETE FROM logs" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects multiple statements", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT 1; SELECT 2" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects missing sql", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("rejects PRAGMAs", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "PRAGMA table_info(logs)" }),
		});
		expect(res.status).toBe(400);
	});

	test("auto-adds LIMIT to unbounded SELECTs", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT * FROM logs" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBeLessThanOrEqual(10000);
	});
});

// ── POST /query/stream ──────────────────────────────────────────────────

describe("POST /query/stream", () => {
	test("returns NDJSON stream", async () => {
		const res = await fetch(url("/query/stream"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT * FROM logs LIMIT 3" }),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");

		const text = await res.text();
		const lines = text.trim().split("\n").filter(Boolean);
		expect(lines.length).toBeGreaterThanOrEqual(1);
		for (const line of lines) {
			const parsed = JSON.parse(line);
			expect(typeof parsed.id).toBe("number");
		}
	});

	test("rejects write queries", async () => {
		const res = await fetch(url("/query/stream"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "INSERT INTO logs VALUES (1)" }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects missing sql", async () => {
		const res = await fetch(url("/query/stream"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});
});

// ── GET /stream (SSE) ───────────────────────────────────────────────────

describe("GET /stream", () => {
	test("receives SSE events for new logs", async () => {
		const res = await fetch(url("/stream"), {
			headers: bearerHeaders(),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		// Read the initial ": connected" comment
		const { value: connectChunk } = await reader.read();
		const connectMsg = decoder.decode(connectChunk);
		expect(connectMsg).toContain("connected");

		// Ingest a log to trigger an SSE event
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "sse-test-msg" }),
		});

		// Wait for the debounce + read
		const chunks: string[] = [];
		const timeout = setTimeout(() => reader.cancel(), 2000);
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value);
				chunks.push(chunk);
				if (chunk.includes("sse-test-msg")) break;
			}
		} finally {
			clearTimeout(timeout);
			reader.cancel();
		}

		const allData = chunks.join("");
		expect(allData).toContain("sse-test-msg");
	});

	test("supports stream filters", async () => {
		const res = await fetch(url("/stream?level=error&service=filtered-svc"), {
			headers: bearerHeaders(),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/event-stream");

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();

		// Read connected message
		await reader.read();

		// Ingest a non-matching log
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "should-not-appear", service: "other" }),
		});

		// Ingest a matching log
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "error", message: "should-appear", service: "filtered-svc" }),
		});

		const chunks: string[] = [];
		const timeout = setTimeout(() => reader.cancel(), 2000);
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				const chunk = decoder.decode(value);
				chunks.push(chunk);
				if (chunk.includes("should-appear")) break;
			}
		} finally {
			clearTimeout(timeout);
			reader.cancel();
		}

		const allData = chunks.join("");
		expect(allData).toContain("should-appear");
		expect(allData).not.toContain("should-not-appear");
	});

	test("rejects invalid level filter", async () => {
		const res = await fetch(url("/stream?level=nope"), {
			headers: bearerHeaders(),
		});
		expect(res.status).toBe(400);
	});
});

// ── POST /prune ─────────────────────────────────────────────────────────

describe("POST /prune", () => {
	test("prunes logs before a timestamp", async () => {
		// Ingest old logs
		const oldTimestamp = new Date(Date.now() - 86_400_000 * 30).toISOString();
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ level: "info", message: "old-log", timestamp: oldTimestamp }),
		});

		const cutoff = Date.now() - 86_400_000 * 7; // 7 days ago
		const res = await fetch(url("/prune"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ before: cutoff }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(typeof body.deleted).toBe("number");
		expect(body.deleted).toBeGreaterThanOrEqual(1);
	});

	test("rejects missing before field", async () => {
		const res = await fetch(url("/prune"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("rejects invalid JSON", async () => {
		const res = await fetch(url("/prune"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});
});

// ── 404 ─────────────────────────────────────────────────────────────────

describe("unknown routes", () => {
	test("returns 404", async () => {
		const res = await fetch(url("/nonexistent"), { headers: bearerHeaders() });
		expect(res.status).toBe(404);
	});
});

// ── Meta fields roundtrip ───────────────────────────────────────────────

describe("meta and fields roundtrip", () => {
	test("meta object is preserved through ingest and query", async () => {
		const meta = { userId: 42, tags: ["a", "b"], nested: { x: 1 } };
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				level: "info",
				message: "meta-roundtrip",
				meta,
				service: "rt-svc",
				host: "rt-host",
				pid: 1234,
				trace_id: "trace-rt",
				span_id: "span-rt",
				project: "rt-project",
				branch: "rt-branch",
			}),
		});

		const res = await fetch(url("/logs?grep=meta-roundtrip"), { headers: bearerHeaders() });
		const body = await res.json();
		const row = body.rows[0];

		expect(row.service).toBe("rt-svc");
		expect(row.host).toBe("rt-host");
		expect(row.pid).toBe(1234);
		expect(row.trace_id).toBe("trace-rt");
		expect(row.span_id).toBe("span-rt");
		expect(row.project).toBe("rt-project");
		expect(row.branch).toBe("rt-branch");
		const meta_out = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
		expect(meta_out.userId).toBe(42);
		expect(meta_out.tags).toEqual(["a", "b"]);
		expect(meta_out.nested.x).toBe(1);
	});
});
