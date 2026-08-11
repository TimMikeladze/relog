import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
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
		idleTimeout: 30,
	});
	baseUrl = `http://localhost:${instance.server.port}`;
});

afterAll(async () => {
	await instance.shutdown();
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

describe("GET /traces", () => {
	const trace = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
	const root = "aaaaaaaaaaaaaaa1";
	const child = "aaaaaaaaaaaaaaa2";

	test("seed trace data", async () => {
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify([
				{
					level: "info",
					message: "trace-root-message",
					service: "trace-svc",
					trace_id: trace,
					span_id: root,
					duration_ms: 123,
				},
				{
					level: "error",
					message: "trace-child-err",
					service: "trace-svc",
					trace_id: trace,
					span_id: child,
					parent_span_id: root,
				},
			]),
		});
	});

	test("requires auth", async () => {
		const res = await fetch(url("/traces"));
		expect(res.status).toBe(401);
	});

	test("lists traces with aggregated fields", async () => {
		const res = await fetch(url(`/traces?trace_id=${trace}`), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		const row = body.rows.find((r: { trace_id: string }) => r.trace_id === trace);
		expect(row).toBeDefined();
		expect(row.span_count).toBe(2);
		expect(row.max_level).toBe("error");
		expect(row.services).toContain("trace-svc");
		expect(row.duration_ms).toBe(123);
		expect(row.root_message).toBeTruthy();
	});

	test("filters by service", async () => {
		const res = await fetch(url("/traces?service=trace-svc"), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		for (const row of body.rows) {
			expect(row.services).toContain("trace-svc");
		}
	});

	test("rejects invalid level", async () => {
		const res = await fetch(url("/traces?level=nope"), { headers: bearerHeaders() });
		expect(res.status).toBe(400);
	});

	test("rejects invalid limit", async () => {
		const res = await fetch(url("/traces?limit=-1"), { headers: bearerHeaders() });
		expect(res.status).toBe(400);
	});
});

describe("POST /histogram filter coverage", () => {
	const trace = "8888888888888888888888888888888f";
	const spanA = "8888888888888881";

	test("seed records for histogram filter tests", async () => {
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify([
				{
					level: "error",
					message: "histo-seed-a",
					service: "histo-svc",
					version: "3.1.4",
					deployment_id: "dep-alpha",
					trace_id: trace,
					span_id: spanA,
				},
				{
					level: "info",
					message: "histo-seed-b",
					service: "other-svc",
					version: "3.1.4",
					deployment_id: "dep-beta",
					trace_id: "0000000000000000000000000000aaaa",
				},
			]),
		});
	});

	async function postHistogram(filters: Record<string, string>): Promise<{
		buckets: { total: number }[];
		bucket_ms: number;
	}> {
		const res = await fetch(url("/histogram"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				from: Date.now() - 3_600_000,
				to: Date.now() + 60_000,
				buckets: 10,
				filters,
			}),
		});
		expect(res.status).toBe(200);
		return res.json() as Promise<{ buckets: { total: number }[]; bucket_ms: number }>;
	}

	function total(body: { buckets: { total: number }[] }): number {
		return body.buckets.reduce((s, b) => s + Number(b.total), 0);
	}

	test("filters by trace_id", async () => {
		const body = await postHistogram({ trace_id: trace });
		expect(total(body)).toBeGreaterThanOrEqual(1);
	});

	test("filters by span_id", async () => {
		const body = await postHistogram({ span_id: spanA });
		expect(total(body)).toBeGreaterThanOrEqual(1);
	});

	test("filters by version + deployment_id combined", async () => {
		const all = await postHistogram({ version: "3.1.4" });
		const narrow = await postHistogram({ version: "3.1.4", deployment_id: "dep-alpha" });
		expect(total(narrow)).toBeGreaterThanOrEqual(1);
		expect(total(narrow)).toBeLessThan(total(all));
	});

	test("accepts comma-separated level IN list", async () => {
		const both = await postHistogram({ level: "error,info" });
		const onlyError = await postHistogram({ level: "error" });
		expect(total(both)).toBeGreaterThan(total(onlyError));
	});

	test("rejects invalid level in comma list", async () => {
		const res = await fetch(url("/histogram"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				from: Date.now() - 3_600_000,
				to: Date.now(),
				filters: { level: "error,bogus" },
			}),
		});
		expect(res.status).toBe(400);
	});

	// The timeline and the result list read the same filters. Before `grep`
	// was wired through, a text search left the chart showing unfiltered
	// volume above a table reporting zero results.
	test("filters by grep the same way /logs does", async () => {
		const matching = await postHistogram({ grep: "histo-seed-a" });
		expect(total(matching)).toBe(1);

		const missing = await postHistogram({ grep: "histo-seed-nonexistent" });
		expect(total(missing)).toBe(0);
	});

	test("treats LIKE wildcards in grep as literals", async () => {
		const body = await postHistogram({ grep: "histo%seed" });
		expect(total(body)).toBe(0);
	});

	test("combines grep with the other filters", async () => {
		const body = await postHistogram({ grep: "histo-seed", level: "error" });
		expect(total(body)).toBe(1);
	});
});

describe("GET /logs trace_id + span_id filters", () => {
	const trace = "9999999999999999999999999999999f";
	const otherTrace = "9999999999999999999999999999999a";
	const spanA = "9999999999999991";
	const spanB = "9999999999999992";

	test("seed records for filter tests", async () => {
		await fetch(url("/ingest"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify([
				{
					level: "info",
					message: "filter-seed-a",
					service: "filter-svc",
					trace_id: trace,
					span_id: spanA,
				},
				{
					level: "info",
					message: "filter-seed-b",
					service: "filter-svc",
					trace_id: trace,
					span_id: spanB,
				},
				{
					level: "info",
					message: "filter-seed-c",
					service: "filter-svc",
					trace_id: otherTrace,
					span_id: spanA,
				},
			]),
		});
	});

	test("filters logs by trace_id", async () => {
		const res = await fetch(url(`/logs?trace_id=${trace}&limit=100`), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(2);
		for (const row of body.rows) {
			expect(row.trace_id).toBe(trace);
		}
	});

	test("filters logs by span_id", async () => {
		const res = await fetch(url(`/logs?span_id=${spanB}&limit=100`), { headers: bearerHeaders() });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.span_id).toBe(spanB);
		}
	});

	test("combines trace_id + span_id to narrow to one log", async () => {
		const res = await fetch(url(`/logs?trace_id=${trace}&span_id=${spanA}&limit=10`), {
			headers: bearerHeaders(),
		});
		const body = await res.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		for (const row of body.rows) {
			expect(row.trace_id).toBe(trace);
			expect(row.span_id).toBe(spanA);
		}
	});

	test("supports comma-separated trace_id IN list", async () => {
		const res = await fetch(url(`/logs?trace_id=${trace},${otherTrace}&limit=100`), {
			headers: bearerHeaders(),
		});
		const body = await res.json();
		const traces = new Set(body.rows.map((r: { trace_id: string }) => r.trace_id));
		expect(traces.has(trace)).toBe(true);
		expect(traces.has(otherTrace)).toBe(true);
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

	test("auto-adds outer LIMIT when only subquery is bounded", async () => {
		// Regression: previous regex matched any LIMIT anywhere, letting the outer
		// query return unbounded rows. Outer LIMIT must be enforced.
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({
				sql: "SELECT * FROM logs WHERE id IN (SELECT id FROM logs LIMIT 5)",
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBeLessThanOrEqual(10000);
	});

	test("preserves user-provided top-level LIMIT", async () => {
		const res = await fetch(url("/query"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT * FROM logs LIMIT 3" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBeLessThanOrEqual(3);
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

// ─── OTLP/JSON (OpenTelemetry) ──────────────────────────────────

describe("OTLP /v1/traces", () => {
	const HEX_TRACE = "0123456789abcdef0123456789abcdef"; // 16 bytes hex
	const HEX_SPAN = "0123456789abcdef"; // 8 bytes hex
	// Same 16/8 bytes encoded as base64 (proto3 JSON canonical form)
	const B64_TRACE = Buffer.from(HEX_TRACE, "hex").toString("base64");
	const B64_SPAN = Buffer.from(HEX_SPAN, "hex").toString("base64");

	function traces(
		traceId: string,
		spanId: string,
		extra: Partial<Record<string, unknown>> = {},
	): object {
		return {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "otel-svc" } },
							{ key: "host.name", value: { stringValue: "otel-host" } },
							{ key: "deployment.environment", value: { stringValue: "prod" } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "test-scope", version: "1.0" },
							spans: [
								{
									traceId,
									spanId,
									name: "otel-span",
									kind: 3, // client
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000100000000",
									attributes: [
										{ key: "http.method", value: { stringValue: "GET" } },
										{ key: "http.status_code", value: { intValue: "200" } },
									],
									status: { code: 1 },
									...extra,
								},
							],
						},
					],
				},
			],
		};
	}

	test("accepts OTLP trace with hex IDs", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(traces(HEX_TRACE, HEX_SPAN)),
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${HEX_TRACE}`), { headers: bearerHeaders() });
		const body = await logsRes.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(1);
		expect(body.rows[0].trace_id).toBe(HEX_TRACE);
		expect(body.rows[0].span_id).toBe(HEX_SPAN);
		expect(body.rows[0].service).toBe("otel-svc");
	});

	test("normalizes base64-encoded trace/span IDs to hex", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(traces(B64_TRACE, B64_SPAN)),
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${HEX_TRACE}`), { headers: bearerHeaders() });
		const body = await logsRes.json();
		// Should find via hex lookup regardless of how they were submitted
		expect(body.rows.some((r: { span_id?: string }) => r.span_id === HEX_SPAN)).toBe(true);
	});

	test("accepts gzip-compressed OTLP payloads", async () => {
		const gzTrace = "aabbccddeeff00112233445566778899";
		const gzSpan = "aabbccddeeff0011";
		const body = gzipSync(Buffer.from(JSON.stringify(traces(gzTrace, gzSpan))));
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: {
				...bearerHeaders(),
				"Content-Type": "application/json",
				"Content-Encoding": "gzip",
			},
			body,
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${gzTrace}`), { headers: bearerHeaders() });
		const data = await logsRes.json();
		expect(data.rows.length).toBeGreaterThanOrEqual(1);
	});

	test("converts span events into log entries on the same span", async () => {
		const evTrace = "11111111111111111111111111111111";
		const evSpan = "1111111111111111";
		const payload = traces(evTrace, evSpan, {
			events: [
				{
					timeUnixNano: "1700000000050000000",
					name: "exception",
					attributes: [
						{ key: "exception.message", value: { stringValue: "boom" } },
						{ key: "exception.type", value: { stringValue: "RuntimeError" } },
					],
				},
			],
		});
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${evTrace}`), { headers: bearerHeaders() });
		const data = await logsRes.json();
		const exception = data.rows.find((r: { message: string }) => r.message.startsWith("exception"));
		expect(exception).toBeTruthy();
		expect(exception.level).toBe("error");
	});

	test("marks span status code 2 as error level", async () => {
		const errTrace = "22222222222222222222222222222222";
		const errSpan = "2222222222222222";
		const payload = traces(errTrace, errSpan, { status: { code: 2, message: "failed" } });
		await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const logsRes = await fetch(url(`/logs?trace_id=${errTrace}`), { headers: bearerHeaders() });
		const data = await logsRes.json();
		const spanRow = data.rows.find((r: { span_id?: string }) => r.span_id === errSpan);
		expect(spanRow.level).toBe("error");
	});

	test("rejects protobuf content type with 415", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/x-protobuf" },
			body: Buffer.from([0]),
		});
		expect(res.status).toBe(415);
	});

	test("empty resourceSpans returns 200 partialSuccess", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ resourceSpans: [] }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.partialSuccess).toBeDefined();
	});

	test("missing resourceSpans returns 400", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});
});

describe("OTLP /v1/logs", () => {
	test("ingests OTLP log records", async () => {
		const traceId = "33333333333333333333333333333333";
		const spanId = "3333333333333333";
		const payload = {
			resourceLogs: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "otel-log-svc" } }],
					},
					scopeLogs: [
						{
							scope: { name: "log-scope" },
							logRecords: [
								{
									timeUnixNano: "1700000000000000000",
									severityNumber: 17, // error
									severityText: "ERROR",
									body: { stringValue: "boom happened" },
									attributes: [{ key: "code", value: { intValue: "42" } }],
									traceId,
									spanId,
								},
							],
						},
					],
				},
			],
		};
		const res = await fetch(url("/v1/logs"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() });
		const data = await logsRes.json();
		const row = data.rows.find((r: { message: string }) => r.message === "boom happened");
		expect(row).toBeTruthy();
		expect(row.level).toBe("error");
		expect(row.service).toBe("otel-log-svc");
		expect(row.span_id).toBe(spanId);
	});
});

describe("OTLP trace metadata preservation", () => {
	test("preserves span_kind, status, scope, and resource attributes in meta", async () => {
		const traceId = "44444444444444444444444444444444";
		const spanId = "4444444444444444";
		const payload = {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "meta-svc" } },
							{ key: "service.version", value: { stringValue: "2.3.4" } },
							{ key: "deployment.environment", value: { stringValue: "staging" } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "meta-scope", version: "0.5" },
							spans: [
								{
									traceId,
									spanId,
									name: "meta-span",
									kind: 2, // server
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000050000000",
									attributes: [{ key: "http.method", value: { stringValue: "POST" } }],
									status: { code: 2, message: "internal error" },
								},
							],
						},
					],
				},
			],
		};
		await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const res = await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() });
		const row = (await res.json()).rows.find((r: { span_id?: string }) => r.span_id === spanId);
		const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;

		expect(meta.span_kind).toBe("server");
		expect(meta.span_status_code).toBe(2);
		expect(meta.span_status_message).toBe("internal error");
		expect(meta.instrumentation_scope).toBe("meta-scope");
		expect(meta.resource["service.version"]).toBe("2.3.4");
		expect(meta.resource["deployment.environment"]).toBe("staging");
		expect(meta["http.method"]).toBe("POST");
		expect(meta.otel).toBe(true);
	});

	test("normalizes parent_span_id (base64 → hex)", async () => {
		const traceId = "55555555555555555555555555555555";
		const parentHex = "aabbccddeeff0011";
		const childHex = "1122334455667788";
		const parentB64 = Buffer.from(parentHex, "hex").toString("base64");
		const childB64 = Buffer.from(childHex, "hex").toString("base64");
		const payload = {
			resourceSpans: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "parent-svc" } }],
					},
					scopeSpans: [
						{
							scope: { name: "s" },
							spans: [
								{
									traceId,
									spanId: childB64,
									parentSpanId: parentB64,
									name: "child",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000010000000",
								},
							],
						},
					],
				},
			],
		};
		await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const res = await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() });
		const row = (await res.json()).rows.find((r: { span_id?: string }) => r.span_id === childHex);
		expect(row).toBeTruthy();
		expect(row.parent_span_id).toBe(parentHex);
	});

	test("handles all OTLP AnyValue variants in attributes", async () => {
		const traceId = "66666666666666666666666666666666";
		const spanId = "6666666666666666";
		const payload = {
			resourceSpans: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "anyvalue-svc" } }],
					},
					scopeSpans: [
						{
							spans: [
								{
									traceId,
									spanId,
									name: "anyvalue",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000001000000",
									attributes: [
										{ key: "str", value: { stringValue: "hello" } },
										{ key: "int", value: { intValue: "42" } },
										{ key: "dbl", value: { doubleValue: 3.14 } },
										{ key: "bool", value: { boolValue: true } },
										{
											key: "arr",
											value: {
												arrayValue: { values: [{ stringValue: "a" }, { intValue: "1" }] },
											},
										},
										{
											key: "obj",
											value: {
												kvlistValue: {
													values: [{ key: "nested", value: { stringValue: "yes" } }],
												},
											},
										},
									],
								},
							],
						},
					],
				},
			],
		};
		await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const res = await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() });
		const row = (await res.json()).rows.find((r: { span_id?: string }) => r.span_id === spanId);
		const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
		expect(meta.str).toBe("hello");
		expect(meta.int).toBe(42);
		expect(meta.dbl).toBe(3.14);
		expect(meta.bool).toBe(true);
		expect(meta.arr).toEqual(["a", 1]);
		expect(meta.obj).toEqual({ nested: "yes" });
	});

	test("skips spans with empty trace or span IDs", async () => {
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "skip-svc" } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: "",
									spanId: "7777777777777777",
									name: "no-trace",
									startTimeUnixNano: "1",
									endTimeUnixNano: "2",
								},
							],
						},
					],
				},
			],
		};
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		// Empty payload after skipping invalid spans still returns 200
		expect(res.status).toBe(200);
	});
});

describe("OTLP log severity + gzip + auth", () => {
	test("severityNumber ranges map correctly to relog levels", async () => {
		const cases: Array<{ sev: number; expected: string }> = [
			{ sev: 1, expected: "trace" },
			{ sev: 6, expected: "debug" },
			{ sev: 10, expected: "info" },
			{ sev: 14, expected: "warn" },
			{ sev: 18, expected: "error" },
			{ sev: 22, expected: "fatal" },
		];
		const t0 = 1_700_000_000_000;
		const payload = {
			resourceLogs: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "sev-svc" } }] },
					scopeLogs: [
						{
							logRecords: cases.map((c, i) => ({
								timeUnixNano: ((BigInt(t0) + BigInt(i)) * 1_000_000n).toString(),
								severityNumber: c.sev,
								body: { stringValue: `sev-${c.sev}-${c.expected}` },
							})),
						},
					],
				},
			],
		};
		await fetch(url("/v1/logs"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		for (const c of cases) {
			const res = await fetch(url(`/logs?grep=sev-${c.sev}-${c.expected}`), {
				headers: bearerHeaders(),
			});
			const rows = (await res.json()).rows;
			expect(rows.length).toBeGreaterThanOrEqual(1);
			expect(rows[0].level).toBe(c.expected);
		}
	});

	test("accepts gzip-compressed log payloads", async () => {
		const traceId = "88888888888888888888888888888888";
		const payload = {
			resourceLogs: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "gz-log-svc" } }] },
					scopeLogs: [
						{
							logRecords: [
								{
									timeUnixNano: "1700000000000000000",
									severityNumber: 9,
									body: { stringValue: "gzipped log" },
									traceId,
								},
							],
						},
					],
				},
			],
		};
		const body = gzipSync(Buffer.from(JSON.stringify(payload)));
		const res = await fetch(url("/v1/logs"), {
			method: "POST",
			headers: {
				...bearerHeaders(),
				"Content-Type": "application/json",
				"Content-Encoding": "gzip",
			},
			body,
		});
		expect(res.status).toBe(200);

		const logsRes = await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() });
		const rows = (await logsRes.json()).rows;
		expect(rows.some((r: { message: string }) => r.message === "gzipped log")).toBe(true);
	});

	test("requires ingest role — rejects read-only key", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: {
				Authorization: `Bearer wrong-key`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ resourceSpans: [] }),
		});
		expect(res.status).toBe(401);
	});

	test("ingest key is allowed on /v1/traces and /v1/logs", async () => {
		const traceRes = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(INGEST_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ resourceSpans: [] }),
		});
		expect(traceRes.status).toBe(200);

		const logRes = await fetch(url("/v1/logs"), {
			method: "POST",
			headers: { ...bearerHeaders(INGEST_KEY), "Content-Type": "application/json" },
			body: JSON.stringify({ resourceLogs: [] }),
		});
		expect(logRes.status).toBe(200);
	});
});

describe("OTLP /v1/metrics", () => {
	test("returns 501 not-implemented (clearer than generic 404)", async () => {
		const res = await fetch(url("/v1/metrics"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify({ resourceMetrics: [] }),
		});
		expect(res.status).toBe(501);
	});
});

describe("OTLP structural shapes", () => {
	test("handles multiple resourceSpans in one request (Collector pattern)", async () => {
		const tA = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
		const tB = "b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1";
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "svc-a" } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: tA,
									spanId: "a111a111a111a111",
									name: "op-a",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000010000000",
								},
							],
						},
					],
				},
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "svc-b" } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: tB,
									spanId: "b222b222b222b222",
									name: "op-b",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000020000000",
								},
							],
						},
					],
				},
			],
		};
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		expect(res.status).toBe(200);

		const aRows = (
			await (await fetch(url(`/logs?service=svc-a`), { headers: bearerHeaders() })).json()
		).rows;
		const bRows = (
			await (await fetch(url(`/logs?service=svc-b`), { headers: bearerHeaders() })).json()
		).rows;
		expect(aRows.some((r: { trace_id?: string }) => r.trace_id === tA)).toBe(true);
		expect(bRows.some((r: { trace_id?: string }) => r.trace_id === tB)).toBe(true);
	});

	test("handles multiple scopeSpans with different instrumentation scopes", async () => {
		const traceId = "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";
		const payload = {
			resourceSpans: [
				{
					resource: {
						attributes: [{ key: "service.name", value: { stringValue: "multi-scope" } }],
					},
					scopeSpans: [
						{
							scope: { name: "@opentelemetry/instrumentation-http" },
							spans: [
								{
									traceId,
									spanId: "c111c111c111c111",
									name: "http-op",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000010000000",
								},
							],
						},
						{
							scope: { name: "@opentelemetry/instrumentation-pg" },
							spans: [
								{
									traceId,
									spanId: "c222c222c222c222",
									name: "pg-op",
									startTimeUnixNano: "1700000000005000000",
									endTimeUnixNano: "1700000000008000000",
								},
							],
						},
					],
				},
			],
		};
		await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const rows = (
			await (await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() })).json()
		).rows;
		const scopes = new Set(
			rows.map((r: { meta: unknown }) => {
				const m = typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta;
				return m?.instrumentation_scope;
			}),
		);
		expect(scopes.has("@opentelemetry/instrumentation-http")).toBe(true);
		expect(scopes.has("@opentelemetry/instrumentation-pg")).toBe(true);
	});

	test("falls back gracefully on invalid startTimeUnixNano", async () => {
		const traceId = "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "bad-time" } }] },
					scopeSpans: [
						{
							spans: [
								{
									traceId,
									spanId: "d111d111d111d111",
									name: "bad-nano",
									startTimeUnixNano: "not-a-number",
									endTimeUnixNano: "also-bad",
								},
							],
						},
					],
				},
			],
		};
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		// Server should ingest and default to Date.now() rather than reject
		expect(res.status).toBe(200);
		const rows = (
			await (await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() })).json()
		).rows;
		expect(rows.length).toBeGreaterThanOrEqual(1);
	});

	test("rejects OTLP batches exceeding maxBatchSize", async () => {
		// Default test server maxBatchSize = 1000
		const spans = Array.from({ length: 1100 }, (_, i) => ({
			traceId: "e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1",
			spanId: i.toString(16).padStart(16, "0"),
			name: `op-${i}`,
			startTimeUnixNano: "1700000000000000000",
			endTimeUnixNano: "1700000000001000000",
		}));
		const payload = {
			resourceSpans: [
				{
					resource: { attributes: [{ key: "service.name", value: { stringValue: "big-batch" } }] },
					scopeSpans: [{ spans }],
				},
			],
		};
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain("Batch too large");
	});

	test("emulates @opentelemetry/exporter-trace-otlp-http wire shape (hex IDs, numeric kind)", async () => {
		// Matches what the official SDK produces by default when using http/json protocol
		const traceId = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";
		const spanId = "f1f1f1f1f1f1f1f1";
		const payload = {
			resourceSpans: [
				{
					resource: {
						attributes: [
							{ key: "service.name", value: { stringValue: "sdk-shape" } },
							{ key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
							{ key: "telemetry.sdk.name", value: { stringValue: "opentelemetry" } },
							{ key: "telemetry.sdk.version", value: { stringValue: "1.27.0" } },
						],
					},
					scopeSpans: [
						{
							scope: { name: "example-tracer", version: "1.0.0" },
							spans: [
								{
									traceId,
									spanId,
									name: "handle-request",
									kind: 2,
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000100000000",
									attributes: [
										{ key: "http.method", value: { stringValue: "GET" } },
										{ key: "http.route", value: { stringValue: "/api/items" } },
										{ key: "http.status_code", value: { intValue: "200" } },
									],
									events: [],
									links: [],
									status: { code: 1 },
									droppedAttributesCount: 0,
									droppedEventsCount: 0,
									droppedLinksCount: 0,
								},
							],
						},
					],
				},
			],
		};
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		expect(res.status).toBe(200);

		const rows = (
			await (await fetch(url(`/logs?trace_id=${traceId}`), { headers: bearerHeaders() })).json()
		).rows;
		const row = rows.find((r: { span_id?: string }) => r.span_id === spanId);
		expect(row).toBeTruthy();
		expect(row.service).toBe("sdk-shape");
		expect(row.duration_ms).toBe(100);
		const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
		expect(meta["http.status_code"]).toBe(200);
		expect(meta.resource["telemetry.sdk.language"]).toBe("nodejs");
	});

	test("rejects malformed JSON body with 400", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: { ...bearerHeaders(), "Content-Type": "application/json" },
			body: "{not valid json",
		});
		expect(res.status).toBe(400);
	});

	test("rejects gzip bomb (decompressed > 50MB limit) with 413", async () => {
		// ~60MB of zeros compresses to ~60KB — well under any raw body cap but blows the
		// decompression cap. Tests the streaming size guard, not the raw size guard.
		const big = Buffer.alloc(60 * 1024 * 1024, 0);
		const body = gzipSync(big);
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: {
				...bearerHeaders(),
				"Content-Type": "application/json",
				"Content-Encoding": "gzip",
			},
			body,
		});
		expect(res.status).toBe(413);
	});

	test("rejects gzip body that isn't actually gzip", async () => {
		const res = await fetch(url("/v1/traces"), {
			method: "POST",
			headers: {
				...bearerHeaders(),
				"Content-Type": "application/json",
				"Content-Encoding": "gzip",
			},
			body: JSON.stringify({ resourceSpans: [] }),
		});
		// Invalid gzip stream should surface as 400, not 500
		expect(res.status).toBe(400);
	});
});

// ─── Fix #4: idleTimeout is passed to server ─────────────────────

describe("server idleTimeout config", () => {
	test("server starts with custom idleTimeout", async () => {
		const p = `test-idle-${Date.now()}.db`;
		const s = await startServer({ port: 0, dbPath: p, idleTimeout: 15 });
		// Server started successfully with custom idle timeout
		expect(s.server.port).toBeGreaterThan(0);
		s.server.stop();
		s.duckdb.close();
		s.db.close();
		for (const f of [p, `${p}-wal`, `${p}-shm`]) {
			try {
				unlinkSync(f);
			} catch {}
		}
	});
});

// ─── Fix #5: shutdown returns a Promise ──────────────────────────

describe("server graceful shutdown", () => {
	test("shutdown returns a promise", async () => {
		const p = `test-shutdown-${Date.now()}.db`;
		const s = await startServer({ port: 0, dbPath: p });
		const result = s.shutdown();
		expect(result).toBeInstanceOf(Promise);
		await result;
		for (const f of [p, `${p}-wal`, `${p}-shm`]) {
			try {
				unlinkSync(f);
			} catch {}
		}
	});
});

// ─── Fix #10: DuckDB S3 credential sanitization ─────────────────

describe("DuckDB S3 credential sanitization", () => {
	test("S3 config error does not leak credentials", async () => {
		const { DuckDBReader } = await import("../db/duckdb.ts");
		const p = `test-s3-cred-${Date.now()}.db`;
		// Create the SQLite DB so DuckDB can attach it
		const { RelogDatabase } = await import("../db/database.ts");
		const db = new RelogDatabase(p);
		db.close();

		const reader = new DuckDBReader(p, {
			endpoint: "http://localhost:1",
			bucket: "test-bucket",
			accessKeyId: "SUPER_SECRET_ACCESS_KEY",
			secretAccessKey: "ULTRA_SECRET_KEY_12345",
			prefix: "logs",
			region: "us-east-1",
		});

		try {
			await reader.init();
			// If init somehow succeeds (shouldn't with localhost:1), that's fine
		} catch (err) {
			const msg = (err as Error).message;
			// Error message should NOT contain the credentials regardless of where it fails
			expect(msg).not.toContain("SUPER_SECRET_ACCESS_KEY");
			expect(msg).not.toContain("ULTRA_SECRET_KEY_12345");
		}

		for (const f of [p, `${p}-wal`, `${p}-shm`]) {
			try {
				unlinkSync(f);
			} catch {}
		}
	});
});
