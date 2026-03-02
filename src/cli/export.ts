import { writeFileSync } from "node:fs";
import { type Command, command, number, string } from "@drizzle-team/brocli";
import { escapeCsv, resolveAuth } from "./shared.ts";

export const exportCommand: Command = command({
	name: "export",
	desc: "Export logs to a file",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		format: string().desc("Output format: json, csv, ndjson").default("json"),
		output: string("output").desc("Output file path").required(),
		from: string().desc("Start time (ISO 8601)"),
		to: string().desc("End time (ISO 8601)"),
		limit: number().desc("Max logs to export").default(10000),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const params = new URLSearchParams();
		if (opts.from) params.set("from", opts.from);
		if (opts.to) params.set("to", opts.to);
		params.set("limit", String(opts.limit));

		const headers: Record<string, string> = {};
		const auth = resolveAuth(opts.auth);
		if (auth) headers["Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;

		const qs = params.toString();
		const response = await fetch(`${opts.url}/logs?${qs}`, { headers });

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
