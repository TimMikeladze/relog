#!/usr/bin/env bun
import { run } from "@drizzle-team/brocli";
import { exportCommand } from "./cli/export.ts";
import { mcpCommand } from "./cli/mcp.ts";
import { pruneCommand } from "./cli/prune.ts";
import { queryCommand } from "./cli/query.ts";
import { searchCommand } from "./cli/search.ts";
import { serveCommand } from "./cli/serve.ts";
import { statsCommand } from "./cli/stats.ts";
import { tailCommand } from "./cli/tail.ts";

run(
	[
		serveCommand,
		tailCommand,
		queryCommand,
		searchCommand,
		statsCommand,
		pruneCommand,
		exportCommand,
		mcpCommand,
	],
	{
		name: "relog",
		description: "Universal logging system",
		version: "0.1.0",
	},
);
