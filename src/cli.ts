#!/usr/bin/env bun
import { run } from "@drizzle-team/brocli";
import { archiveCommand } from "./cli/archive.ts";
import { archiverServiceCommand } from "./cli/archiver-service.ts";
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
		archiveCommand,
		archiverServiceCommand,
		mcpCommand,
	],
	{
		name: "relog.dev",
		description: "Universal logging system",
		version: "0.1.0",
	},
);
