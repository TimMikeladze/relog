import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { startServer, type ServerInstance } from "../src/server/server.ts";

const TEST_DB = "test-otel-examples.db";
const REPO_ROOT = join(import.meta.dir, "..");

let instance: ServerInstance;
let baseUrl: string;

function cleanup() {
	for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
		try {
			unlinkSync(f);
		} catch {}
	}
}

beforeAll(async () => {
	cleanup();
	instance = await startServer({
		port: 0,
		dbPath: TEST_DB,
		streamDebounceMs: 10,
		idleTimeout: 30,
	});
	baseUrl = `http://localhost:${instance.server.port}`;
});

afterAll(async () => {
	await instance.shutdown();
	cleanup();
});

describe("examples/otel/otel-sdk.ts", () => {
	test("runs via @opentelemetry/sdk-node and exports spans to relog", async () => {
		const proc = Bun.spawn(["bun", "examples/otel/otel-sdk.ts"], {
			cwd: REPO_ROOT,
			env: { ...process.env, RELOG_URL: baseUrl },
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Exporting to");

		// The SDK uses its own random trace IDs — filter by service instead.
		const logsRes = await fetch(`${baseUrl}/logs?service=otel-sdk-example&limit=20`);
		const body = await logsRes.json();
		expect(body.rows.length).toBeGreaterThanOrEqual(3);

		// Should see server root + client db.query + internal render
		const names = new Set(body.rows.map((r: { message: string }) => r.message));
		expect(names.has("handle-request")).toBe(true);
		expect(names.has("db.query")).toBe(true);
		expect(names.has("render")).toBe(true);

		// Verify OTel metadata made it through
		const rootRow = body.rows.find((r: { message: string }) => r.message === "handle-request");
		const meta = typeof rootRow.meta === "string" ? JSON.parse(rootRow.meta) : rootRow.meta;
		expect(meta.otel).toBe(true);
		expect(meta.span_kind).toBe("server");
		expect(meta["http.method"]).toBe("GET");
		expect(meta.resource["service.version"]).toBe("0.1.0");
		// SDK-native trace IDs must be 32 hex chars after normalization
		expect(rootRow.trace_id).toMatch(/^[0-9a-f]{32}$/);
	}, 30_000);
});

describe("examples/otel/otel-raw.ts", () => {
	test("runs end-to-end against live server and ingests OTLP data", async () => {
		const proc = Bun.spawn(["bun", "examples/otel/otel-raw.ts"], {
			cwd: REPO_ROOT,
			env: { ...process.env, RELOG_URL: baseUrl },
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		expect(exitCode).toBe(0);
		expect(stdout).toContain("/v1/traces → 200");
		expect(stdout).toContain("/v1/logs → 200");
		// stderr may contain harmless bun warnings but must not contain runtime errors
		expect(stderr).not.toMatch(/error:|Error:|\bthrow\b|\bTypeError\b/);

		// Verify the example actually produced the expected records.
		// Use service filter because the log record and spans share the same service,
		// while trace IDs are randomized per run.
		const logsRes = await fetch(`${baseUrl}/logs?service=checkout-api&limit=20`);
		const body = await logsRes.json();

		// Expect at least: 3 spans + 1 span event + 1 log record = 5 rows
		expect(body.rows.length).toBeGreaterThanOrEqual(5);

		// Pick out the span rows (those with a trace_id)
		const spans = body.rows.filter((r: { trace_id?: string | null }) => r.trace_id != null);
		expect(spans.length).toBeGreaterThanOrEqual(4);

		// All spans share the same trace_id and it must be 32 hex chars
		const traceIds = new Set(spans.map((r: { trace_id: string }) => r.trace_id));
		expect(traceIds.size).toBe(1);
		const [traceId] = traceIds;
		expect(traceId).toMatch(/^[0-9a-f]{32}$/);

		// Root span: POST /checkout, server kind, status ok, duration ~240ms
		const root = spans.find((r: { message: string }) => r.message === "POST /checkout");
		expect(root).toBeTruthy();
		expect(root.duration_ms).toBe(240);
		const rootMeta = typeof root.meta === "string" ? JSON.parse(root.meta) : root.meta;
		expect(rootMeta.span_kind).toBe("server");
		expect(rootMeta.span_status_code).toBe(1);
		expect(rootMeta.resource["service.version"]).toBe("1.4.2");
		expect(rootMeta.resource["deployment.environment"]).toBe("production");

		// DB span has a child event
		const event = spans.find((r: { message: string }) => r.message === "slow_query_warning");
		expect(event).toBeTruthy();
		const eventMeta = typeof event.meta === "string" ? JSON.parse(event.meta) : event.meta;
		expect(eventMeta.otel_event).toBe(true);
		expect(eventMeta.threshold_ms).toBe(150);

		// Log record from /v1/logs
		const logRow = body.rows.find((r: { message: string }) => r.message === "checkout completed");
		expect(logRow).toBeTruthy();
		expect(logRow.level).toBe("info");
		const logMeta = typeof logRow.meta === "string" ? JSON.parse(logRow.meta) : logRow.meta;
		expect(logMeta["order.id"]).toBe("ord_789");
		expect(logMeta["order.total"]).toBe(42.5);
	}, 15_000);
});
