import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { authHeaders, buildParams, resolveAuthHeader } from "./cli/shared.ts";

interface McpOptions {
	url: string;
	auth?: string;
}

async function fetchJson(url: string, auth?: string, init?: RequestInit): Promise<unknown> {
	const isPost = init?.method === "POST";
	const baseHeaders = isPost ? authHeaders(auth) : resolveAuthHeader(auth);
	const response = await fetch(url, {
		...init,
		headers: { ...baseHeaders, ...(init?.headers as Record<string, string>) },
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`HTTP ${response.status}: ${text}`);
	}
	return response.json();
}

function textResult(data: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function createMcpServer(opts: McpOptions): McpServer {
	const { url, auth } = opts;

	const server = new McpServer({
		name: "relog.dev",
		version: "0.1.0",
	});

	server.tool(
		"search_logs",
		"Search and filter logs. Supports level, service, project, branch, version, deployment_id, text search, and time ranges.",
		{
			level: z.string().optional().describe("Log level: trace, debug, info, warn, error, fatal"),
			service: z.string().optional().describe("Filter by service name"),
			project: z.string().optional().describe("Filter by project name"),
			branch: z.string().optional().describe("Filter by git branch"),
			version: z.string().optional().describe("Filter by app version"),
			deployment_id: z.string().optional().describe("Filter by deployment ID"),
			grep: z.string().optional().describe("Search text in log messages"),
			from: z
				.string()
				.optional()
				.describe("Start time (ISO 8601 or relative like '1h', '30m', '7d')"),
			to: z.string().optional().describe("End time (ISO 8601 or relative)"),
			limit: z.number().optional().default(50).describe("Max results (default 50)"),
		},
		async (args) => {
			const params = buildParams(args);
			const result = await fetchJson(`${url}/logs?${params}`, auth);
			return textResult(result);
		},
	);

	server.tool(
		"query_logs",
		"Run a read-only SQL query against the logs table. The table has columns: id, timestamp, level, message, meta, service, host, pid, trace_id, span_id, project, branch, version, deployment_id, created_at.",
		{
			sql: z.string().describe("SQL query (SELECT only). A LIMIT is auto-added if missing."),
		},
		async (args) => {
			const result = await fetchJson(`${url}/query`, auth, {
				method: "POST",
				body: JSON.stringify({ sql: args.sql }),
			});
			return textResult(result);
		},
	);

	server.tool(
		"get_stats",
		"Get server health, log counts by level, service breakdown, and project breakdown.",
		{},
		async () => {
			const [health, levels, services, projects] = await Promise.all([
				fetchJson(`${url}/health`, auth),
				fetchJson(`${url}/query`, auth, {
					method: "POST",
					body: JSON.stringify({ sql: "SELECT level, COUNT(*) as count FROM logs GROUP BY level" }),
				}),
				fetchJson(`${url}/query`, auth, {
					method: "POST",
					body: JSON.stringify({
						sql: "SELECT service, COUNT(*) as count FROM logs WHERE service IS NOT NULL GROUP BY service",
					}),
				}),
				fetchJson(`${url}/query`, auth, {
					method: "POST",
					body: JSON.stringify({
						sql: "SELECT project, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project",
					}),
				}),
			]);
			return textResult({ health, levels, services, projects });
		},
	);

	server.tool(
		"tail_logs",
		"Get the most recent logs. Quick way to see what's happening right now.",
		{
			limit: z.number().optional().default(20).describe("Number of recent logs (default 20)"),
			level: z.string().optional().describe("Filter by log level"),
			service: z.string().optional().describe("Filter by service"),
			project: z.string().optional().describe("Filter by project"),
			branch: z.string().optional().describe("Filter by branch"),
			version: z.string().optional().describe("Filter by version"),
			deployment_id: z.string().optional().describe("Filter by deployment ID"),
		},
		async (args) => {
			const params = buildParams(args);
			const result = await fetchJson(`${url}/logs?${params}`, auth);
			return textResult(result);
		},
	);

	server.tool(
		"get_log_context",
		"Get logs surrounding a specific log ID. Useful for understanding what happened before and after a specific event.",
		{
			log_id: z.number().describe("The log ID to get context around"),
			before: z
				.number()
				.optional()
				.default(5)
				.describe("Number of logs before the target (default 5)"),
			after: z
				.number()
				.optional()
				.default(5)
				.describe("Number of logs after the target (default 5)"),
		},
		async (args) => {
			const result = await fetchJson(`${url}/query`, auth, {
				method: "POST",
				body: JSON.stringify({
					sql: "SELECT * FROM logs WHERE id >= ? AND id <= ? ORDER BY id ASC LIMIT ?",
					params: [
						args.log_id - args.before,
						args.log_id + args.after,
						args.before + args.after + 1,
					],
				}),
			});
			return textResult(result);
		},
	);

	return server;
}

export async function startMcpServer(opts: McpOptions): Promise<void> {
	const server = createMcpServer(opts);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
