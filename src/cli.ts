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
import { executeWrap, isWrapMode } from "./cli/run.ts";

const args = process.argv.slice(2);

if (isWrapMode(args)) {
	await executeWrap(args);
} else {
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
			// Replaced at build time by scripts/build-binary.ts so a standalone
			// binary reports the version it was cut from, not a stale literal.
			version: process.env.RELOG_VERSION ?? "0.1.0",
		},
	);
}
