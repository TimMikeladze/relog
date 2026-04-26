import { QueryValidationError, validateQuery } from "../../db/validate.ts";
import type { Widget } from "../../types.ts";
import type { WidgetsManager } from "../widgets.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
// Cap used purely for save-time validation. Runtime LIMIT is set by the
// /query route and is the actual ceiling.
const VALIDATION_MAX_ROWS = 10_000;
const PLACEHOLDER_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * Replace `${name}` placeholders with `NULL` so the SQL parses through
 * `validateQuery` at save time. Real values are interpolated by the
 * frontend at render time and re-validated at /query.
 */
function stubPlaceholders(sql: string): string {
	return sql.replace(PLACEHOLDER_RE, "NULL");
}

function validateWidgetSql(sql: string): string | null {
	try {
		validateQuery(stubPlaceholders(sql), VALIDATION_MAX_ROWS);
		return null;
	} catch (err) {
		if (err instanceof QueryValidationError) return err.message;
		return err instanceof Error ? err.message : "SQL validation failed";
	}
}

export async function handleWidgets(
	request: Request,
	widgetsManager: WidgetsManager,
	_keyPrefix?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method;
	const pathParts = url.pathname.split("/").filter(Boolean);
	const id = pathParts[1];

	if (id && !VALID_ID.test(id)) {
		return Response.json({ error: "Invalid widget ID" }, { status: 400 });
	}

	if (method === "GET") {
		if (id) {
			const w = widgetsManager.get(id);
			if (w) return Response.json({ widget: w });
			return Response.json({ error: "Widget not found" }, { status: 404 });
		}
		return Response.json({ widgets: widgetsManager.getAll() });
	}

	if (method === "POST") {
		let body: Omit<Widget, "createdAt" | "updatedAt">;
		try {
			body = (await request.json()) as Omit<Widget, "createdAt" | "updatedAt">;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
		if (!body?.id || !body?.name || !body?.kind || !body?.sql || !body?.options || !body?.layout) {
			return Response.json(
				{ error: "Missing required fields: id, name, kind, sql, options, layout" },
				{ status: 400 },
			);
		}
		if (!VALID_ID.test(body.id)) {
			return Response.json({ error: "Invalid widget ID" }, { status: 400 });
		}
		const existing = widgetsManager.get(body.id);
		if (existing?.builtin) {
			return Response.json({ error: "Cannot overwrite builtin widget" }, { status: 409 });
		}
		const sqlError = validateWidgetSql(body.sql);
		if (sqlError) {
			return Response.json({ error: `Invalid widget SQL: ${sqlError}` }, { status: 400 });
		}
		const widget = await widgetsManager.add({ ...body, builtin: false });
		return Response.json({ widget }, { status: 201 });
	}

	if (method === "PUT") {
		if (!id) {
			return Response.json({ error: "Missing widget ID" }, { status: 400 });
		}
		let body: Partial<Widget>;
		try {
			body = (await request.json()) as Partial<Widget>;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
		const existing = widgetsManager.get(id);
		if (!existing) {
			return Response.json({ error: "Widget not found" }, { status: 404 });
		}
		if (existing.builtin) {
			const { layout, ...rest } = body;
			if (Object.keys(rest).length > 0) {
				return Response.json(
					{ error: "Only layout is mutable on builtin widgets" },
					{ status: 403 },
				);
			}
			const updated = await widgetsManager.update(id, { layout });
			return Response.json({ widget: updated });
		}
		const {
			id: _ignoredId,
			createdAt: _ignoredCreatedAt,
			builtin: _ignoredBuiltin,
			...safePatch
		} = body;
		if (typeof safePatch.sql === "string") {
			const sqlError = validateWidgetSql(safePatch.sql);
			if (sqlError) {
				return Response.json({ error: `Invalid widget SQL: ${sqlError}` }, { status: 400 });
			}
		}
		const updated = await widgetsManager.update(id, safePatch);
		if (!updated) {
			return Response.json({ error: "Widget not found" }, { status: 404 });
		}
		return Response.json({ widget: updated });
	}

	if (method === "DELETE") {
		if (!id) {
			return Response.json({ error: "Missing widget ID" }, { status: 400 });
		}
		const existing = widgetsManager.get(id);
		if (!existing) {
			return Response.json({ error: "Widget not found" }, { status: 404 });
		}
		if (existing.builtin) {
			return Response.json({ error: "Cannot delete builtin widget" }, { status: 403 });
		}
		await widgetsManager.delete(id);
		return new Response(null, { status: 204 });
	}

	return Response.json({ error: "Method not allowed" }, { status: 405 });
}
