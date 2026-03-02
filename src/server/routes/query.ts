import type { SQLQueryBindings } from "bun:sqlite";
import { QueryValidationError } from "../../db/database.ts";
import type { RelogDatabase } from "../../db/database.ts";

interface QueryBody {
	sql: string;
	params?: SQLQueryBindings[];
}

function queryErrorMessage(err: unknown): string {
	if (err instanceof QueryValidationError) return err.message;
	return "Query execution failed";
}

export async function handleQuery(
	request: Request,
	db: RelogDatabase,
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
		const result = db.query(body.sql, body.params);
		return Response.json(result);
	} catch (err) {
		return Response.json(
			{ error: queryErrorMessage(err) },
			{ status: 400 },
		);
	}
}

export async function handleQueryStream(
	request: Request,
	db: RelogDatabase,
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

	let iterator: IterableIterator<Record<string, unknown>>;
	try {
		iterator = db.queryIterator(body.sql, body.params);
	} catch (err) {
		return Response.json(
			{ error: queryErrorMessage(err) },
			{ status: 400 },
		);
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		pull(controller) {
			const { done, value } = iterator.next();
			if (done) {
				controller.close();
				return;
			}
			controller.enqueue(
				encoder.encode(`${JSON.stringify(value)}\n`),
			);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Transfer-Encoding": "chunked",
		},
	});
}
