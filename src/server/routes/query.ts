import { QueryValidationError } from "../../db/validate.ts";
import type { DuckDBReader } from "../../db/duckdb.ts";
import { logRouteError } from "../log.ts";

interface QueryBody {
	sql: string;
	params?: unknown[];
}

// DuckDB errors caused by user-supplied SQL (syntax, missing column, missing
// table, type mismatch, missing function). 400 is the right status — re-running
// the same SQL won't help and the client needs to fix the query. Anything else
// is server-side (IO, OOM, internal planner crash) and should return 500.
const USER_ERROR_PREFIXES = [
	"Parser Error",
	"Binder Error",
	"Catalog Error",
	"Conversion Error",
	"Type Error",
	"Syntax Error",
	"Not implemented Error",
];

function isUserSqlError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message ?? "";
	return USER_ERROR_PREFIXES.some((p) => msg.startsWith(p));
}

export async function handleQuery(
	request: Request,
	duckdb: DuckDBReader,
	keyPrefix?: string,
): Promise<Response> {
	let body: QueryBody;
	try {
		body = (await request.json()) as QueryBody;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.sql) {
		return Response.json({ error: "Missing sql field" }, { status: 400 });
	}

	try {
		const result = await duckdb.query(body.sql, body.params);
		return Response.json(result);
	} catch (err) {
		// Validation errors are user input → 400. Execution errors are
		// server-side (planner crash, OOM, file-not-found on Parquet) →
		// 500 so clients/monitors don't misinterpret them as bad input.
		if (err instanceof QueryValidationError) {
			console.warn(`[relog.dev] /query rejected: ${err.message} (keyPrefix=${keyPrefix ?? "_"})`);
			return Response.json({ error: err.message }, { status: 400 });
		}
		if (isUserSqlError(err)) {
			return Response.json({ error: "Query execution failed" }, { status: 400 });
		}
		logRouteError("POST /query", err, { keyPrefix, sql: body.sql });
		return Response.json({ error: "Query execution failed" }, { status: 500 });
	}
}

export async function handleQueryStream(
	request: Request,
	duckdb: DuckDBReader,
	keyPrefix?: string,
): Promise<Response> {
	let body: QueryBody;
	try {
		body = (await request.json()) as QueryBody;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400 });
	}

	if (!body.sql) {
		return Response.json({ error: "Missing sql field" }, { status: 400 });
	}

	const encoder = new TextEncoder();

	let iterator: AsyncIterableIterator<Record<string, unknown>>;
	try {
		// Force validation before creating the stream by calling .next() once eagerly
		iterator = duckdb.queryStream(body.sql);
		const first = await iterator.next();

		const stream = new ReadableStream({
			start(controller) {
				if (!first.done) {
					controller.enqueue(encoder.encode(`${JSON.stringify(first.value)}\n`));
				} else {
					controller.close();
				}
			},
			async pull(controller) {
				try {
					const { done, value } = await iterator.next();
					if (done) {
						controller.close();
						return;
					}
					controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
				} catch (err) {
					controller.error(err);
				}
			},
			cancel() {
				iterator.return?.();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "application/x-ndjson",
				"Transfer-Encoding": "chunked",
			},
		});
	} catch (err) {
		if (err instanceof QueryValidationError) {
			console.warn(
				`[relog.dev] /query/stream rejected: ${err.message} (keyPrefix=${keyPrefix ?? "_"})`,
			);
			return Response.json({ error: err.message }, { status: 400 });
		}
		if (isUserSqlError(err)) {
			return Response.json({ error: "Query execution failed" }, { status: 400 });
		}
		logRouteError("POST /query/stream", err, { keyPrefix, sql: body.sql });
		return Response.json({ error: "Query execution failed" }, { status: 500 });
	}
}
