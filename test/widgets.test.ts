import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
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
