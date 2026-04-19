import { writeFileSync } from "node:fs";
import { type Command, command, number, string } from "@drizzle-team/brocli";
import { buildParams, escapeCsv, resolveAuthHeader } from "./shared.ts";

export const exportCommand: Command = command({
	name: "export",
	desc: "Export logs to a file",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		format: string().desc("Output format: json, csv, ndjson").default("json"),
		output: string("output").desc("Output file path").required(),
		from: string().desc("Start time (ISO 8601)"),
		to: string().desc("End time (ISO 8601)"),
		project: string().desc("Filter by project"),
		branch: string().desc("Filter by branch"),
		traceId: string("trace-id").desc("Filter by trace ID"),
		spanId: string("span-id").desc("Filter by span ID"),
		limit: number().desc("Max logs to export").default(10000),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const params = buildParams({
			from: opts.from,
			to: opts.to,
			project: opts.project,
			branch: opts.branch,
			trace_id: opts.traceId,
			span_id: opts.spanId,
			limit: opts.limit,
		});

		const response = await fetch(`${opts.url}/logs?${params}`, {
			headers: resolveAuthHeader(opts.auth),
		});

		if (!response.ok) {
			console.error(`Export failed: ${response.status}`);
			process.exit(1);
		}

		const result = (await response.json()) as {
			rows: Record<string, unknown>[];
			total: number;
		};

		let output: string;

		if (opts.format === "csv") {
			if (result.rows.length === 0) {
				output = "";
			} else {
				const keys = Object.keys(result.rows[0]!);
				const lines = [keys.map(escapeCsv).join(",")];
				for (const row of result.rows) {
					lines.push(keys.map((k) => escapeCsv(row[k])).join(","));
				}
				output = lines.join("\n");
			}
		} else if (opts.format === "ndjson") {
			output = result.rows.map((r) => JSON.stringify(r)).join("\n");
		} else {
			output = JSON.stringify(result.rows, null, 2);
		}

		writeFileSync(opts.output, output);
		console.log(
			`Exported ${result.rows.length} logs to ${opts.output}` +
				(result.total > result.rows.length
					? ` (${result.total} total, use --limit to export more)`
					: ""),
		);
	},
});
