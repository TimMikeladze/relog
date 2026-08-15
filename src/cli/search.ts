import { type Command, command, number, string } from "@drizzle-team/brocli";
import { printLogRecord } from "../console.ts";
import type { LogRecord } from "../types.ts";
import { apiFetch, buildParams, resolveAuthHeader } from "./shared.ts";

export const searchCommand: Command = command({
	name: "search",
	desc: "Search logs with filters",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		from: string().desc("Start time (ISO 8601 or relative like '1h')"),
		to: string().desc("End time (ISO 8601)"),
		level: string().desc("Filter by log level"),
		service: string().desc("Filter by service name"),
		grep: string().desc("Search message text"),
		project: string().desc("Filter by project"),
		branch: string().desc("Filter by branch"),
		traceId: string("trace-id").desc("Filter by trace ID"),
		spanId: string("span-id").desc("Filter by span ID"),
		limit: number().desc("Max results to return").default(100),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const params = buildParams({
			level: opts.level,
			service: opts.service,
			grep: opts.grep,
			project: opts.project,
			branch: opts.branch,
			trace_id: opts.traceId,
			span_id: opts.spanId,
			from: opts.from,
			to: opts.to,
			limit: opts.limit,
		});

		const response = await apiFetch(`${opts.url}/logs?${params}`, {
			headers: resolveAuthHeader(opts.auth),
		});

		if (!response.ok) {
			console.error(`Search failed: ${response.status}`);
			process.exit(1);
		}

		const result = (await response.json()) as {
			rows: LogRecord[];
			total: number;
		};

		for (const row of result.rows) {
			printLogRecord(row);
		}

		console.error(`\n${result.rows.length} of ${result.total} results`);
	},
});
