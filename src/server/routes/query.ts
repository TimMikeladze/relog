import { QueryValidationError } from "../../db/validate.ts";
import type { DuckDBReader } from "../../db/duckdb.ts";
import { logRouteError } from "../log.ts";

interface QueryBody {
	sql: string;
	params?: unknown[];
}

function queryErrorMessage(err: unknown): string {
	if (err instanceof QueryValidationError) return err.message;
	return "Query execution failed";
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
		// Validation errors are user input — message is enough. Execution
		// errors are server-side; the helper attaches a stack on Error.
		if (err instanceof QueryValidationError) {
			console.warn(
				`[relog.dev] /query rejected: ${err.message} (keyPrefix=${keyPrefix ?? "_"})`,
			);
		} else {
			logRouteError("POST /query", err, { keyPrefix, sql: body.sql });
		}
		return Response.json({ error: queryErrorMessage(err) }, { status: 400 });
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
		} else {
			logRouteError("POST /query/stream", err, { keyPrefix, sql: body.sql });
		}
		return Response.json({ error: queryErrorMessage(err) }, { status: 400 });
	}
}
