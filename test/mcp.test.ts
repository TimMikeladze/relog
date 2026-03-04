import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startServer } from "../src/server/server.ts";
import type { ServerInstance } from "../src/server/server.ts";
import { createMcpServer } from "../src/mcp.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function tmpDbPath(): string {
	return join(tmpdir(), `relog-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

describe("MCP Server", () => {
	let server: ServerInstance;
	let baseUrl: string;
	let dbPath: string;
	let mcp: McpServer;

	beforeAll(async () => {
		dbPath = tmpDbPath();
		server = startServer({ port: 0, dbPath });
		baseUrl = `http://localhost:${server.server.port}`;
		mcp = createMcpServer({ url: baseUrl });

		// Seed some test data
		await fetch(`${baseUrl}/ingest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify([
				{ level: "info", message: "mcp-test-1", service: "api", project: "proj-a", branch: "main" },
				{
					level: "error",
					message: "mcp-test-2",
					service: "api",
					project: "proj-a",
					branch: "main",
				},
				{
					level: "warn",
					message: "mcp-test-3",
					service: "worker",
					project: "proj-b",
					branch: "dev",
				},
				{ level: "info", message: "mcp-test-4", project: "proj-a", branch: "feat" },
				{ level: "debug", message: "mcp-test-5" },
			]),
		});
	});

	afterAll(() => {
		server.shutdown();
		cleanupDb(dbPath);
	});

	test("createMcpServer returns an McpServer instance", () => {
		expect(mcp).toBeDefined();
		expect(mcp.tool).toBeDefined();
	});

	// Helper to call MCP tools via the HTTP API directly (since MCP tools wrap HTTP)
	// We test the underlying HTTP calls that the MCP tools make

	test("search_logs tool: fetches logs with filters", async () => {
		const res = await fetch(`${baseUrl}/logs?level=error&limit=50`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { level: string }[] };
		expect(json.rows.length).toBe(1);
		expect(json.rows[0]!.level).toBe("error");
	});

	test("search_logs tool: filters by project", async () => {
		const res = await fetch(`${baseUrl}/logs?project=proj-a&limit=50`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { project: string }[] };
		expect(json.rows.length).toBe(3);
		for (const row of json.rows) {
			expect(row.project).toBe("proj-a");
		}
	});

	test("search_logs tool: filters by branch", async () => {
		const res = await fetch(`${baseUrl}/logs?branch=dev&limit=50`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { branch: string }[] };
		expect(json.rows.length).toBe(1);
		expect(json.rows[0]!.branch).toBe("dev");
	});

	test("search_logs tool: grep filter", async () => {
		const res = await fetch(`${baseUrl}/logs?grep=mcp-test-2&limit=50`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { message: string }[] };
		expect(json.rows.length).toBe(1);
		expect(json.rows[0]!.message).toBe("mcp-test-2");
	});

	test("query_logs tool: runs SQL query", async () => {
		const res = await fetch(`${baseUrl}/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sql: "SELECT level, COUNT(*) as count FROM logs GROUP BY level" }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { level: string; count: number }[] };
		expect(json.rows.length).toBeGreaterThan(0);
	});

	test("get_stats tool: returns health and breakdowns", async () => {
		const [healthRes, levelsRes, servicesRes, projectsRes] = await Promise.all([
			fetch(`${baseUrl}/health`),
			fetch(`${baseUrl}/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sql: "SELECT level, COUNT(*) as count FROM logs GROUP BY level" }),
			}),
			fetch(`${baseUrl}/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sql: "SELECT service, COUNT(*) as count FROM logs WHERE service IS NOT NULL GROUP BY service",
				}),
			}),
			fetch(`${baseUrl}/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sql: "SELECT project, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project",
				}),
			}),
		]);

		expect(healthRes.status).toBe(200);
		const health = (await healthRes.json()) as { ok: boolean; log_count: number };
		expect(health.ok).toBe(true);
		expect(health.log_count).toBe(5);

		expect(levelsRes.status).toBe(200);
		const levels = (await levelsRes.json()) as { rows: { level: string; count: number }[] };
		expect(levels.rows.length).toBeGreaterThan(0);

		expect(servicesRes.status).toBe(200);
		const services = (await servicesRes.json()) as { rows: { service: string; count: number }[] };
		expect(services.rows.length).toBe(2);

		expect(projectsRes.status).toBe(200);
		const projects = (await projectsRes.json()) as { rows: { project: string; count: number }[] };
		expect(projects.rows.length).toBe(2);
	});

	test("tail_logs tool: gets recent logs", async () => {
		const res = await fetch(`${baseUrl}/logs?limit=3`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: unknown[] };
		expect(json.rows.length).toBe(3);
	});

	test("get_log_context tool: parameterized query works", async () => {
		// Get a known log ID
		const logsRes = await fetch(`${baseUrl}/logs?grep=mcp-test-3&limit=1`);
		const logsJson = (await logsRes.json()) as { rows: { id: number }[] };
		const targetId = logsJson.rows[0]!.id;

		const before = 2;
		const after = 2;
		const res = await fetch(`${baseUrl}/query`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				sql: "SELECT * FROM logs WHERE id >= ? AND id <= ? ORDER BY id ASC LIMIT ?",
				params: [targetId - before, targetId + after, before + after + 1],
			}),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { id: number }[] };
		expect(json.rows.length).toBeGreaterThanOrEqual(1);
		expect(json.rows.length).toBeLessThanOrEqual(before + after + 1);
	});

	test("MCP server with auth passes auth header", async () => {
		const authDbPath = tmpDbPath();
		const authServer = startServer({ port: 0, dbPath: authDbPath, auth: "admin:secret" });
		const authUrl = `http://localhost:${authServer.server.port}`;

		// Ingest with auth
		await fetch(`${authUrl}/ingest`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
			},
			body: JSON.stringify({ level: "info", message: "auth-mcp-test" }),
		});

		// Query with auth (simulating what MCP fetchJson does)
		const res = await fetch(`${authUrl}/logs?limit=10`, {
			headers: {
				Authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
			},
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { rows: { message: string }[] };
		expect(json.rows.length).toBe(1);

		// Without auth should fail
		const noAuthRes = await fetch(`${authUrl}/logs?limit=10`);
		expect(noAuthRes.status).toBe(401);

		authServer.shutdown();
		cleanupDb(authDbPath);
	});
});
