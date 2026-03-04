import { type Command, command, string } from "@drizzle-team/brocli";
import { resolveAuth } from "./shared.ts";

export const mcpCommand: Command = command({
	name: "mcp",
	desc: "Start MCP server for AI agent integration (stdio transport)",
	options: {
		url: string().desc("Relog server URL").default("http://localhost:3485"),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const { startMcpServer } = await import("../mcp.ts");
		await startMcpServer({
			url: opts.url,
			auth: resolveAuth(opts.auth),
		});
	},
});
