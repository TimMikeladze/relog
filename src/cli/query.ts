import { type Command, command, string } from "@drizzle-team/brocli";
import type { QueryResult } from "../types.ts";
import { apiFetch, authHeaders, escapeCsv } from "./shared.ts";

export const queryCommand: Command = command({
	name: "query",
	desc: "Run read-only SQL against the log database",
	options: {
		url: string().desc("Server URL").default("http://localhost:3485"),
		db: string().desc("Query a database file directly, without a server (e.g. ~/.relog/relog.db)"),
		sql: string().desc("SQL query to execute").required(),
		format: string().desc("Output format: json, table, csv").default("table"),
		auth: string().desc("Bearer token (API key). Also reads RELOG_AUTH env"),
	},
	handler: async (opts) => {
		const result = opts.db ? await queryFile(opts.db, opts.sql) : await queryServer(opts);
		render(result, opts.format);
	},
});

/**
 * Reads a database file in-process. `--db` wins over `--url`.
 *
 * DuckDB is imported lazily so the other subcommands never pay for it: in the
 * standalone binary the first `require` of the addon unpacks ~30MB into
 * ~/.relog/native/, which `relog send` has no reason to trigger.
 */
async function queryFile(path: string, sql: string): Promise<QueryResult> {
	const { DuckDBReader } = await import("../db/duckdb.ts");
	const { QueryValidationError } = await import("../db/validate.ts");

	const reader = new DuckDBReader(path);
	try {
		await reader.init();
	} catch (err) {
		console.error(`Cannot open ${path}`);
		console.error(`  ${(err as Error).message}`);
		process.exit(1);
	}

	try {
		return await reader.query(sql);
	} catch (err) {
		// Same read-only validation the server applies, so the rejection text is
		// already user-facing; anything else is a genuine execution failure.
		if (err instanceof QueryValidationError) {
			console.error(`Query rejected: ${err.message}`);
		} else {
			console.error(`Query failed: ${(err as Error).message}`);
		}
		process.exit(1);
	} finally {
		reader.close();
	}
}

async function queryServer(opts: {
	url: string;
	sql: string;
	auth?: string;
}): Promise<QueryResult> {
	const response = await apiFetch(`${opts.url}/query`, {
		method: "POST",
		headers: authHeaders(opts.auth),
		body: JSON.stringify({ sql: opts.sql }),
	});

	if (!response.ok) {
		const body = (await response.json()) as { error?: string };
		console.error(`Query failed: ${body.error ?? response.status}`);
		process.exit(1);
	}

	return (await response.json()) as QueryResult;
}

function render(result: QueryResult, format: string): void {
	if (format === "json") {
		console.log(JSON.stringify(result.rows, null, 2));
	} else if (format === "csv") {
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
}
