#!/usr/bin/env bun
process.on("unhandledRejection", (err) => {
	console.error("[relog.dev] Unhandled promise rejection:", err);
});

import { run } from "@drizzle-team/brocli";
import { deleteDbCommand } from "./cli/delete-db.ts";
import { exportCommand } from "./cli/export.ts";
import { mcpCommand } from "./cli/mcp.ts";
import { pruneCommand } from "./cli/prune.ts";
import { queryCommand } from "./cli/query.ts";
import { searchCommand } from "./cli/search.ts";
import { seedCommand } from "./cli/seed.ts";
import { sendCommand } from "./cli/send.ts";
import { startCommand } from "./cli/serve.ts";
import { statsCommand } from "./cli/stats.ts";
import { tailCommand } from "./cli/tail.ts";

run(
	[
		startCommand,
		sendCommand,
		seedCommand,
		tailCommand,
		queryCommand,
		searchCommand,
		statsCommand,
		pruneCommand,
		exportCommand,
		mcpCommand,
		deleteDbCommand,
	],
	{
		name: "relog.dev",
		description: "Universal logging system",
		version: "0.1.0",
	},
);
