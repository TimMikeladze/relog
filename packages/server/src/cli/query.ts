import { type Command, command, string } from "@drizzle-team/brocli";
import { authHeaders, escapeCsv } from "./shared.ts";

export const queryCommand: Command = command({
	name: "query",
	desc: "Run read-only SQL against the log database",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		sql: string().desc("SQL query to execute").required(),
		format: string()
			.desc("Output format: json, table, csv")
			.default("table"),
		auth: string().desc("Basic auth (user:pass). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const response = await fetch(`${opts.url}/query`, {
			method: "POST",
			headers: authHeaders(opts.auth),
			body: JSON.stringify({ sql: opts.sql }),
		});

		if (!response.ok) {
			const body = (await response.json()) as { error?: string };
			console.error(`Query failed: ${body.error ?? response.status}`);
			process.exit(1);
		}

		const result = (await response.json()) as {
			rows: Record<string, unknown>[];
			count: number;
			time_ms: number;
		};

		if (opts.format === "json") {
			console.log(JSON.stringify(result.rows, null, 2));
		} else if (opts.format === "csv") {
			if (result.rows.length > 0) {
				const keys = Object.keys(result.rows[0]!);
				console.log(keys.map(escapeCsv).join(","));
				for (const row of result.rows) {
					console.log(keys.map((k) => escapeCsv(row[k])).join(","));
				}
			}
		} else {
			console.table(result.rows);
		}

		console.error(`\n${result.count} rows (${result.time_ms}ms)`);
	},
});
