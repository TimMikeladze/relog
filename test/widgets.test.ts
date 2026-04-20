import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { handleWidgets } from "../src/server/routes/widgets.ts";
import { WidgetsManager } from "../src/server/widgets.ts";
import type { Widget } from "../src/types.ts";

function tmpFile(): string {
	return join(tmpdir(), `relog-widgets-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function makeWidget(
	id: string,
	overrides: Partial<Widget> = {},
): Omit<Widget, "createdAt" | "updatedAt"> {
	return {
		id,
		name: `Widget ${id}`,
		kind: "stat",
		sql: "SELECT 1 AS value",
		options: { valueField: "value" },
		layout: { x: 0, y: 0, w: 4, h: 2 },
		...overrides,
	};
}

describe("WidgetsManager", () => {
	const created: string[] = [];
	afterEach(() => {
		for (const p of created.splice(0)) {
			try {
				unlinkSync(p);
			} catch {}
		}
	});

	test("adds and persists a widget", async () => {
		const path = tmpFile();
		created.push(path);
		const m1 = new WidgetsManager(path);
		await m1.init();

		await m1.add(makeWidget("x"));

		const m2 = new WidgetsManager(path);
		await m2.init();
		const loaded = m2.get("x");
		expect(loaded).not.toBeNull();
		expect(loaded!.name).toBe("Widget x");
	});

	test("update persists", async () => {
		const path = tmpFile();
		created.push(path);
		const m = new WidgetsManager(path);
		await m.init();
		await m.add(makeWidget("u", { name: "Original" }));
		await m.update("u", { name: "Updated" });

		const m2 = new WidgetsManager(path);
		await m2.init();
		expect(m2.get("u")!.name).toBe("Updated");
	});

	test("delete persists", async () => {
		const path = tmpFile();
		created.push(path);
		const m = new WidgetsManager(path);
		await m.init();
		await m.add(makeWidget("d"));
		expect(await m.delete("d")).toBe(true);

		const m2 = new WidgetsManager(path);
		await m2.init();
		expect(m2.get("d")).toBeNull();
	});

	test("cannot delete builtin widget", async () => {
		const path = tmpFile();
		created.push(path);
		const m = new WidgetsManager(path);
		await m.init();
		await m.add({ ...makeWidget("bi"), builtin: true });
		expect(await m.delete("bi")).toBe(false);
		expect(m.get("bi")).not.toBeNull();
	});

	test("init on empty file seeds DEFAULT_WIDGETS", async () => {
		const path = tmpFile();
		created.push(path);
		const m = new WidgetsManager(path);
		await m.init();
		const all = m.getAll();
		expect(all.length).toBeGreaterThanOrEqual(11);
		for (const id of ["total-logs", "error-rate", "errors-over-time", "top-errors"]) {
			expect(m.get(id)).not.toBeNull();
			expect(m.get(id)!.builtin).toBe(true);
		}
	});
});

async function req(method: string, path: string, body?: unknown): Promise<Request> {
	return new Request(`http://localhost${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("handleWidgets", () => {
	test("GET /widgets returns seeded widgets", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("GET", "/widgets"), m);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { widgets: Widget[] };
		expect(Array.isArray(body.widgets)).toBe(true);
		expect(body.widgets.length).toBeGreaterThanOrEqual(11);
	});

	test("GET /widgets/:id returns a widget", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("GET", "/widgets/total-logs"), m);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { widget: Widget };
		expect(body.widget.id).toBe("total-logs");
	});

	test("GET /widgets/:id returns 404 for missing", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("GET", "/widgets/missing"), m);
		expect(res.status).toBe(404);
	});

	test("POST /widgets creates a widget", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("POST", "/widgets", makeWidget("custom")), m);
		expect(res.status).toBe(201);
		expect(m.get("custom")).not.toBeNull();
		expect(m.get("custom")!.builtin).toBe(false);
	});

	test("POST /widgets rejects missing fields", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("POST", "/widgets", { id: "x" }), m);
		expect(res.status).toBe(400);
	});

	test("POST /widgets rejects bad id", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("POST", "/widgets", makeWidget("bad id!")), m);
		expect(res.status).toBe(400);
	});

	test("POST /widgets with existing builtin id returns 409", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("POST", "/widgets", makeWidget("total-logs")), m);
		expect(res.status).toBe(409);
	});

	test("PUT /widgets/:id updates a user widget", async () => {
		const m = new WidgetsManager();
		await m.init();
		await m.add(makeWidget("u"));
		const res = await handleWidgets(await req("PUT", "/widgets/u", { name: "Renamed" }), m);
		expect(res.status).toBe(200);
		expect(m.get("u")!.name).toBe("Renamed");
	});

	test("PUT /widgets/:id allows layout-only edit on builtin", async () => {
		const m = new WidgetsManager();
		await m.init();
		const newLayout = { x: 2, y: 2, w: 6, h: 3 };
		const res = await handleWidgets(
			await req("PUT", "/widgets/total-logs", { layout: newLayout }),
			m,
		);
		expect(res.status).toBe(200);
		expect(m.get("total-logs")!.layout).toEqual(newLayout);
	});

	test("PUT /widgets/:id rejects non-layout edits on builtin", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(
			await req("PUT", "/widgets/total-logs", { name: "Renamed" }),
			m,
		);
		expect(res.status).toBe(403);
	});

	test("DELETE /widgets/:id removes user widget", async () => {
		const m = new WidgetsManager();
		await m.init();
		await m.add(makeWidget("rm"));
		const res = await handleWidgets(await req("DELETE", "/widgets/rm"), m);
		expect(res.status).toBe(200);
		expect(m.get("rm")).toBeNull();
	});

	test("DELETE /widgets/:id on builtin returns 403", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("DELETE", "/widgets/total-logs"), m);
		expect(res.status).toBe(403);
		expect(m.get("total-logs")).not.toBeNull();
	});
});
