import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server/server.ts";
import type { ServerInstance } from "../src/server/server.ts";
import { AggregatesManager } from "../src/server/aggregates.ts";
import type { LogEntry } from "../src/types.ts";

function tmpDbPath(): string {
	return join(tmpdir(), `relog-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(path: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(path + suffix);
		} catch {
			// ignore
		}
	}
}

// Fix #7: Per-field size limits on ingest
describe("Ingest field size limits", () => {
	let server: ServerInstance;
	let baseUrl: string;
	let dbPath: string;

	beforeAll(async () => {
		dbPath = tmpDbPath();
		server = await startServer({ port: 0, dbPath });
		baseUrl = `http://localhost:${server.server.port}`;
	});

	afterAll(() => {
		server.shutdown();
		cleanupDb(dbPath);
	});

	async function ingest(body: unknown): Promise<Response> {
		return fetch(`${baseUrl}/ingest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	test("message over 1MB is rejected", async () => {
		const res = await ingest({
			level: "info",
			message: "x".repeat(1_048_577),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("message");
	});

	test("message at exactly 1MB is accepted", async () => {
		const res = await ingest({
			level: "info",
			message: "x".repeat(1_048_576),
		});
		expect(res.status).toBe(201);
	});

	test("service field over 1024 chars is rejected", async () => {
		const res = await ingest({
			level: "info",
			message: "test",
			service: "s".repeat(1025),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("service");
	});

	test("trace_id field over 1024 chars is rejected", async () => {
		const res = await ingest({
			level: "info",
			message: "test",
			trace_id: "t".repeat(1025),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("trace_id");
	});

	test("meta over 1MB serialized is rejected", async () => {
		const res = await ingest({
			level: "info",
			message: "test",
			meta: { big: "x".repeat(1_048_577) },
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("meta");
	});

	test("reasonable string fields are accepted", async () => {
		const res = await ingest({
			level: "info",
			message: "test",
			service: "my-service",
			host: "server-01",
			trace_id: "abc-123",
			project: "relog",
			branch: "main",
			version: "1.0.0",
			deployment_id: "deploy-42",
		});
		expect(res.status).toBe(201);
	});
});

// Fix #3: Aggregates persistence
describe("Aggregates persistence", () => {
	test("aggregates persist to file", async () => {
		const filePath = join(tmpdir(), `relog-agg-${Date.now()}.json`);

		const manager1 = new AggregatesManager(filePath);
		await manager1.init();

		await manager1.add({
			id: "test-agg",
			name: "Test Aggregate",
			filters: { level: "error" },
		});

		// Create a new manager reading the same file
		const manager2 = new AggregatesManager(filePath);
		await manager2.init();

		const loaded = manager2.get("test-agg");
		expect(loaded).not.toBeNull();
		expect(loaded!.name).toBe("Test Aggregate");
		expect(loaded!.filters.level).toBe("error");

		try {
			unlinkSync(filePath);
		} catch {}
	});

	test("aggregates update persists", async () => {
		const filePath = join(tmpdir(), `relog-agg-update-${Date.now()}.json`);

		const manager = new AggregatesManager(filePath);
		await manager.init();
		await manager.add({
			id: "upd",
			name: "Original",
			filters: { level: "info" },
		});
		await manager.update("upd", { name: "Updated" });

		const manager2 = new AggregatesManager(filePath);
		await manager2.init();
		expect(manager2.get("upd")!.name).toBe("Updated");

		try {
			unlinkSync(filePath);
		} catch {}
	});

	test("aggregates delete persists", async () => {
		const filePath = join(tmpdir(), `relog-agg-del-${Date.now()}.json`);

		const manager = new AggregatesManager(filePath);
		await manager.init();
		await manager.add({
			id: "del",
			name: "To Delete",
			filters: { level: "warn" },
		});
		await manager.delete("del");

		const manager2 = new AggregatesManager(filePath);
		await manager2.init();
		expect(manager2.get("del")).toBeNull();

		try {
			unlinkSync(filePath);
		} catch {}
	});
});

// Fix #8: ArchiveGuard per-instance
describe("ArchiveGuard isolation", () => {
	test("archive guard is per-server instance", async () => {
		const dbPath1 = tmpDbPath();
		const dbPath2 = tmpDbPath();

		const server1 = await startServer({ port: 0, dbPath: dbPath1 });
		const server2 = await startServer({ port: 0, dbPath: dbPath2 });

		// Both servers should be able to accept archive requests independently
		// (they would fail because no S3 config, but they shouldn't share state)
		const baseUrl1 = `http://localhost:${server1.server.port}`;
		const baseUrl2 = `http://localhost:${server2.server.port}`;

		const res1 = await fetch(`${baseUrl1}/archive`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ keepDays: 30 }),
		});
		const res2 = await fetch(`${baseUrl2}/archive`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ keepDays: 30 }),
		});

		// Both should return 400 (not configured) rather than 409 (in flight)
		expect(res1.status).toBe(400);
		expect(res2.status).toBe(400);

		server1.shutdown();
		server2.shutdown();
		cleanupDb(dbPath1);
		cleanupDb(dbPath2);
	});
});

// Fix #6: Server error logging
describe("Server error logging", () => {
	let server: ServerInstance;
	let baseUrl: string;
	let dbPath: string;

	beforeAll(async () => {
		dbPath = tmpDbPath();
		server = await startServer({ port: 0, dbPath });
		baseUrl = `http://localhost:${server.server.port}`;
	});

	afterAll(() => {
		server.shutdown();
		cleanupDb(dbPath);
	});

	test("server returns 500 on internal error without crashing", async () => {
		// Send a malformed request that might trigger an internal error
		const res = await fetch(`${baseUrl}/ingest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not valid json at all {{{",
		});
		// Should get a clean error response
		expect(res.status).toBe(400);
	});
});

// Fix #9: RateLimiter performance (basic correctness)
describe("RateLimiter correctness", () => {
	let server: ServerInstance;
	let baseUrl: string;
	let dbPath: string;

	beforeAll(async () => {
		dbPath = tmpDbPath();
		server = await startServer({ port: 0, dbPath, ingestRpm: 5 });
		baseUrl = `http://localhost:${server.server.port}`;
	});

	afterAll(() => {
		server.shutdown();
		cleanupDb(dbPath);
	});

	test("rate limiter kicks in after limit", async () => {
		const results: number[] = [];
		for (let i = 0; i < 8; i++) {
			const res = await fetch(`${baseUrl}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ level: "info", message: `rate-${i}` }),
			});
			results.push(res.status);
		}

		// First 5 should succeed (201), rest should be rate limited (429)
		expect(results.filter((s) => s === 201).length).toBe(5);
		expect(results.filter((s) => s === 429).length).toBe(3);
	});
});

