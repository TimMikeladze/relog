import type { Aggregate } from "../../types.ts";
import type { AggregatesManager } from "../aggregates.ts";

export async function handleAggregates(
	request: Request,
	aggregatesManager: AggregatesManager,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method;
	const pathParts = url.pathname.split("/").filter(Boolean);
	const id = pathParts[1]; // /aggregates/:id

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
		try {
			const body = (await request.json()) as Omit<Aggregate, "createdAt" | "updatedAt">;

			// Validate required fields
			if (!body.id || !body.name || !body.filters) {
				return Response.json(
					{ error: "Missing required fields: id, name, filters" },
					{ status: 400 },
				);
			}

			const aggregate = await aggregatesManager.add(body);
			return Response.json({ aggregate }, { status: 201 });
		} catch (error) {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
	}

	// PUT /aggregates/:id - update aggregate
	if (method === "PUT") {
		if (!id) {
			return Response.json({ error: "Missing aggregate ID" }, { status: 400 });
		}

		try {
			const body = (await request.json()) as Partial<Omit<Aggregate, "id" | "createdAt">>;
			const updated = await aggregatesManager.update(id, body);

			if (!updated) {
				return Response.json({ error: "Aggregate not found" }, { status: 404 });
			}

			return Response.json({ aggregate: updated });
		} catch (error) {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
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
