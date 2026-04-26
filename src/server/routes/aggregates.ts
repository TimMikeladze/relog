import type { Aggregate } from "../../types.ts";
import type { AggregatesManager } from "../aggregates.ts";
import { logRouteError } from "../log.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export async function handleAggregates(
	request: Request,
	aggregatesManager: AggregatesManager,
	keyPrefix?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method;
	const pathParts = url.pathname.split("/").filter(Boolean);
	const id = pathParts[1]; // /aggregates/:id

	if (id && !VALID_ID.test(id)) {
		return Response.json({ error: "Invalid aggregate ID" }, { status: 400 });
	}

	// GET /aggregates or /aggregates/:id
	if (method === "GET") {
		if (id) {
			const agg = aggregatesManager.get(id);
			if (agg) {
				return Response.json({ aggregate: agg });
			}
			return Response.json({ error: "Aggregate not found" }, { status: 404 });
		}
		return Response.json({ aggregates: aggregatesManager.getAll() });
	}

	// POST /aggregates - create new aggregate
	if (method === "POST") {
		let body: Omit<Aggregate, "createdAt" | "updatedAt">;
		try {
			body = (await request.json()) as Omit<Aggregate, "createdAt" | "updatedAt">;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}

		if (!body?.id || !body?.name || !body?.filters) {
			return Response.json(
				{ error: "Missing required fields: id, name, filters" },
				{ status: 400 },
			);
		}

		if (!VALID_ID.test(body.id)) {
			return Response.json({ error: "Invalid aggregate ID" }, { status: 400 });
		}

		try {
			const aggregate = await aggregatesManager.add(body);
			return Response.json({ aggregate }, { status: 201 });
		} catch (error) {
			logRouteError("POST /aggregates", error, { keyPrefix });
			return Response.json({ error: "Failed to create aggregate" }, { status: 500 });
		}
	}

	// PUT /aggregates/:id - update aggregate
	if (method === "PUT") {
		if (!id) {
			return Response.json({ error: "Missing aggregate ID" }, { status: 400 });
		}

		let body: Partial<Omit<Aggregate, "id" | "createdAt">>;
		try {
			body = (await request.json()) as Partial<Omit<Aggregate, "id" | "createdAt">>;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}

		try {
			const updated = await aggregatesManager.update(id, body);
			if (!updated) {
				return Response.json({ error: "Aggregate not found" }, { status: 404 });
			}
			return Response.json({ aggregate: updated });
		} catch (error) {
			logRouteError("PUT /aggregates/:id", error, { keyPrefix, details: { id } });
			return Response.json({ error: "Failed to update aggregate" }, { status: 500 });
		}
	}

	// DELETE /aggregates/:id - delete aggregate
	if (method === "DELETE") {
		if (!id) {
			return Response.json({ error: "Missing aggregate ID" }, { status: 400 });
		}

		const deleted = await aggregatesManager.delete(id);
		if (!deleted) {
			return Response.json({ error: "Aggregate not found" }, { status: 404 });
		}

		return Response.json({ success: true });
	}

	return Response.json({ error: "Method not allowed" }, { status: 405 });
}
