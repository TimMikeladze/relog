import { QueryValidationError, validateQuery } from "../../db/validate.ts";
import type { Dashboard, DashboardVariable, VariableType } from "../../types.ts";
import type { DashboardsManager } from "../dashboards.ts";
import type { WidgetsManager } from "../widgets.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;
/**
 * Variable names become `${name}` placeholders in widget SQL, so they must be
 * SQL-identifier-shaped and cannot collide with the two the runtime always
 * supplies.
 */
const VALID_VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;
const RESERVED_VARIABLES = new Set(["from", "to"]);
const VALID_TYPES = new Set<VariableType>(["text", "select", "number"]);
const MAX_VARIABLES = 20;
const MAX_OPTIONS = 500;
const VALIDATION_MAX_ROWS = 10_000;

function validateOptionsSql(sql: string): string | null {
	try {
		validateQuery(sql, VALIDATION_MAX_ROWS);
		return null;
	} catch (err) {
		if (err instanceof QueryValidationError) return err.message;
		return err instanceof Error ? err.message : "SQL validation failed";
	}
}

/**
 * Returns an error message, or null when the variable list is usable. Bad
 * variables are rejected at save time rather than at render time because a
 * malformed one breaks every widget on the dashboard at once, and the user
 * who would see that failure is often not the one who caused it.
 */
export function validateVariables(vars: unknown): string | null {
	if (vars === undefined || vars === null) return null;
	if (!Array.isArray(vars)) return "'variables' must be an array";
	if (vars.length > MAX_VARIABLES) return `Too many variables: max ${MAX_VARIABLES}`;

	const seen = new Set<string>();
	for (const raw of vars) {
		if (typeof raw !== "object" || raw === null) return "Each variable must be an object";
		const v = raw as Partial<DashboardVariable>;
		if (typeof v.name !== "string" || !VALID_VARIABLE_NAME.test(v.name)) {
			return `Invalid variable name: ${JSON.stringify(v.name)}. Must match [a-zA-Z_][a-zA-Z0-9_]*`;
		}
		if (RESERVED_VARIABLES.has(v.name)) {
			return `'${v.name}' is reserved — the time range always provides it`;
		}
		if (seen.has(v.name)) return `Duplicate variable name: ${v.name}`;
		seen.add(v.name);

		if (typeof v.type !== "string" || !VALID_TYPES.has(v.type as VariableType)) {
			return `Invalid type for variable '${v.name}'. Must be one of: ${[...VALID_TYPES].join(", ")}`;
		}
		if (v.label !== undefined && typeof v.label !== "string") {
			return `'label' must be a string on variable '${v.name}'`;
		}
		if (v.options !== undefined) {
			if (!Array.isArray(v.options)) return `'options' must be an array on variable '${v.name}'`;
			if (v.options.length > MAX_OPTIONS) {
				return `Too many options on variable '${v.name}': max ${MAX_OPTIONS}`;
			}
			for (const o of v.options) {
				if (typeof o !== "object" || o === null || typeof o.value !== "string") {
					return `Each option on variable '${v.name}' needs a string 'value'`;
				}
			}
		}
		if (v.optionsSql !== undefined) {
			if (typeof v.optionsSql !== "string") {
				return `'optionsSql' must be a string on variable '${v.name}'`;
			}
			const err = validateOptionsSql(v.optionsSql);
			if (err) return `Invalid optionsSql on variable '${v.name}': ${err}`;
		}
	}
	return null;
}

export async function handleDashboards(
	request: Request,
	dashboardsManager: DashboardsManager,
	widgetsManager: WidgetsManager,
	_keyPrefix?: string,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method;
	const pathParts = url.pathname.split("/").filter(Boolean);
	const id = pathParts[1];

	if (id && !VALID_ID.test(id)) {
		return Response.json({ error: "Invalid dashboard ID" }, { status: 400 });
	}

	if (method === "GET") {
		if (id) {
			const d = dashboardsManager.get(id);
			if (!d) return Response.json({ error: "Dashboard not found" }, { status: 404 });
			// Returned together so opening a dashboard is one request, not two.
			const widgets = widgetsManager.getAll().filter((w) => (w.dashboardId ?? "logs") === id);
			return Response.json({ dashboard: d, widgets });
		}
		return Response.json({ dashboards: dashboardsManager.getAll() });
	}

	if (method === "POST") {
		let body: Omit<Dashboard, "createdAt" | "updatedAt">;
		try {
			body = (await request.json()) as Omit<Dashboard, "createdAt" | "updatedAt">;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
		if (!body?.id || !body?.name) {
			return Response.json({ error: "Missing required fields: id, name" }, { status: 400 });
		}
		if (!VALID_ID.test(body.id)) {
			return Response.json({ error: "Invalid dashboard ID" }, { status: 400 });
		}
		if (dashboardsManager.get(body.id)) {
			return Response.json({ error: "Dashboard already exists" }, { status: 409 });
		}
		const varError = validateVariables(body.variables);
		if (varError) return Response.json({ error: varError }, { status: 400 });

		const dashboard = await dashboardsManager.add({ ...body, builtin: false });
		return Response.json({ dashboard }, { status: 201 });
	}

	if (method === "PUT") {
		if (!id) return Response.json({ error: "Missing dashboard ID" }, { status: 400 });
		let body: Partial<Dashboard>;
		try {
			body = (await request.json()) as Partial<Dashboard>;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
		const existing = dashboardsManager.get(id);
		if (!existing) return Response.json({ error: "Dashboard not found" }, { status: 404 });
		if (existing.builtin) {
			return Response.json({ error: "Cannot modify builtin dashboard" }, { status: 403 });
		}
		if (body.variables !== undefined) {
			const varError = validateVariables(body.variables);
			if (varError) return Response.json({ error: varError }, { status: 400 });
		}
		const {
			id: _ignoredId,
			createdAt: _ignoredCreatedAt,
			builtin: _ignoredBuiltin,
			...safePatch
		} = body;
		const updated = await dashboardsManager.update(id, safePatch);
		if (!updated) return Response.json({ error: "Dashboard not found" }, { status: 404 });
		return Response.json({ dashboard: updated });
	}

	if (method === "DELETE") {
		if (!id) return Response.json({ error: "Missing dashboard ID" }, { status: 400 });
		const existing = dashboardsManager.get(id);
		if (!existing) return Response.json({ error: "Dashboard not found" }, { status: 404 });
		if (existing.builtin) {
			return Response.json({ error: "Cannot delete builtin dashboard" }, { status: 403 });
		}
		// Widgets are deleted with the dashboard. Leaving them behind would
		// orphan them onto the default dashboard, which reads as data loss in
		// the other direction — someone else's dashboard suddenly grows widgets.
		const orphans = widgetsManager.getAll().filter((w) => w.dashboardId === id && !w.builtin);
		for (const w of orphans) {
			await widgetsManager.delete(w.id);
		}
		await dashboardsManager.delete(id);
		return new Response(null, { status: 204 });
	}

	return Response.json({ error: "Method not allowed" }, { status: 405 });
}
