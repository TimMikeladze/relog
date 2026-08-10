import { rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	DashboardsManager,
	DEFAULT_DASHBOARDS,
	DEFAULT_DASHBOARD_ID,
} from "../src/server/dashboards.ts";
import { validateVariables } from "../src/server/routes/dashboards.ts";
import { DEFAULT_WIDGETS } from "../src/server/widgets.ts";
import { startServer } from "../src/server/server.ts";
import type { Dashboard, ServerConfig } from "../src/types.ts";

function tmpPath(prefix: string): string {
	return join(tmpdir(), `relog-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function cleanupDb(path: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(path + suffix);
		} catch {}
	}
}

// ─── Variable validation ────────────────────────────────────────

describe("validateVariables", () => {
	test("accepts absent or empty variables", () => {
		expect(validateVariables(undefined)).toBeNull();
		expect(validateVariables([])).toBeNull();
	});

	test("accepts a well-formed variable", () => {
		expect(
			validateVariables([
				{ name: "site", type: "select", optionsSql: "SELECT DISTINCT site AS value FROM events" },
			]),
		).toBeNull();
	});

	test("rejects names that would not survive placeholder substitution", () => {
		expect(validateVariables([{ name: "1bad", type: "text" }])).toMatch(/Invalid variable name/);
		expect(validateVariables([{ name: "has-dash", type: "text" }])).toMatch(
			/Invalid variable name/,
		);
		expect(validateVariables([{ name: "", type: "text" }])).toMatch(/Invalid variable name/);
	});

	test("rejects names that would shadow the built-in time range", () => {
		expect(validateVariables([{ name: "from", type: "text" }])).toMatch(/reserved/);
		expect(validateVariables([{ name: "to", type: "text" }])).toMatch(/reserved/);
	});

	test("rejects duplicates, which would make substitution ambiguous", () => {
		expect(
			validateVariables([
				{ name: "site", type: "text" },
				{ name: "site", type: "select" },
			]),
		).toMatch(/Duplicate/);
	});

	test("rejects an unknown type", () => {
		expect(validateVariables([{ name: "site", type: "sql" }])).toMatch(/Invalid type/);
	});

	test("rejects optionsSql that would not pass the query validator", () => {
		expect(
			validateVariables([{ name: "x", type: "select", optionsSql: "DROP TABLE logs" }]),
		).toMatch(/Invalid optionsSql/);
		expect(
			validateVariables([{ name: "x", type: "select", optionsSql: "SELECT 1; DELETE FROM logs" }]),
		).toMatch(/Invalid optionsSql/);
	});

	test("rejects a non-array and oversized lists", () => {
		expect(validateVariables("nope")).toMatch(/must be an array/);
		const many = Array.from({ length: 50 }, (_, i) => ({ name: `v${i}`, type: "text" }));
		expect(validateVariables(many)).toMatch(/Too many variables/);
	});
});

// ─── Presets ────────────────────────────────────────────────────

describe("preset dashboards", () => {
	test("every builtin widget belongs to an existing dashboard", () => {
		const ids = new Set(DEFAULT_DASHBOARDS.map((d) => d.id));
		for (const w of DEFAULT_WIDGETS) {
			expect(ids.has(w.dashboardId ?? DEFAULT_DASHBOARD_ID)).toBe(true);
		}
	});

	test("every widget only references variables its dashboard declares", () => {
		const byId = new Map(DEFAULT_DASHBOARDS.map((d) => [d.id, d]));
		const placeholder = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
		for (const w of DEFAULT_WIDGETS) {
			const dashboard = byId.get(w.dashboardId ?? DEFAULT_DASHBOARD_ID)!;
			const declared = new Set(["from", "to", ...(dashboard.variables ?? []).map((v) => v.name)]);
			for (const match of w.sql.matchAll(placeholder)) {
				// An undeclared placeholder silently becomes NULL at render time,
				// which shows plausible numbers for the wrong scope.
				expect({ widget: w.id, placeholder: match[1] }).toEqual({
					widget: w.id,
					placeholder: declared.has(match[1]!) ? match[1] : `UNDECLARED:${match[1]}`,
				});
			}
		}
	});

	test("every builtin dashboard declares valid variables", () => {
		for (const d of DEFAULT_DASHBOARDS) {
			expect(validateVariables(d.variables)).toBeNull();
		}
	});
});

// ─── Manager ────────────────────────────────────────────────────

describe("DashboardsManager", () => {
	let filePath: string;
	let manager: DashboardsManager;

	beforeEach(async () => {
		filePath = `${tmpPath("dashboards")}.json`;
		manager = new DashboardsManager(filePath);
		await manager.init();
	});
	afterEach(() => {
		try {
			unlinkSync(filePath);
		} catch {}
	});

	test("seeds the builtins", () => {
		const ids = manager.getAll().map((d) => d.id);
		expect(ids).toContain(DEFAULT_DASHBOARD_ID);
		expect(ids).toContain("analytics");
	});

	test("sorts by declared order", () => {
		const ordered = manager.getAll();
		expect(ordered[0]!.id).toBe(DEFAULT_DASHBOARD_ID);
		expect(ordered[1]!.id).toBe("analytics");
	});

	test("round-trips a custom dashboard through the file", async () => {
		await manager.add({
			id: "ops",
			name: "Ops",
			variables: [{ name: "namespace", type: "text" }],
			builtin: false,
		});

		const reloaded = new DashboardsManager(filePath);
		await reloaded.init();
		const d = reloaded.get("ops")!;
		expect(d.name).toBe("Ops");
		expect(d.variables?.[0]!.name).toBe("namespace");
	});

	test("refuses to delete a builtin", async () => {
		expect(await manager.delete(DEFAULT_DASHBOARD_ID)).toBe(false);
		expect(manager.get(DEFAULT_DASHBOARD_ID)).not.toBeNull();
	});

	test("preserves id and createdAt across updates", async () => {
		const created = await manager.add({ id: "ops", name: "Ops", builtin: false });
		const updated = await manager.update("ops", {
			name: "Operations",
			id: "hijack",
			createdAt: 0,
		} as Partial<Dashboard>);
		expect(updated!.id).toBe("ops");
		expect(updated!.createdAt).toBe(created.createdAt);
		expect(updated!.name).toBe("Operations");
	});
});

// ─── HTTP ───────────────────────────────────────────────────────

async function withServer(
	fn: (base: string) => Promise<void>,
	extra: Partial<ServerConfig> = {},
): Promise<void> {
	const dbPath = `${tmpPath("srv")}.db`;
	// Own data directory per server: the JSON side-stores otherwise default to
	// ~/.relog, so tests would read and overwrite the developer's real saved
	// dashboards — and leak state into each other.
	const dataDir = tmpPath("data");
	const instance = await startServer({ port: 0, dbPath, dataDir, ...extra });
	try {
		await fn(`http://localhost:${instance.server.port}`);
	} finally {
		await instance.shutdown();
		cleanupDb(dbPath);
		rmSync(dataDir, { recursive: true, force: true });
	}
}

const json = (body: unknown) => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

describe("dashboards HTTP API", () => {
	test("lists the builtins", async () => {
		await withServer(async (base) => {
			const res = await fetch(`${base}/dashboards`);
			expect(res.status).toBe(200);
			const body = await res.json();
			const ids = body.dashboards.map((d: Dashboard) => d.id);
			expect(ids).toContain("logs");
			expect(ids).toContain("analytics");
		});
	});

	test("returns a dashboard together with its widgets", async () => {
		await withServer(async (base) => {
			const body = await (await fetch(`${base}/dashboards/analytics`)).json();
			expect(body.dashboard.id).toBe("analytics");
			expect(body.widgets.length).toBeGreaterThan(0);
			for (const w of body.widgets) {
				expect(w.dashboardId).toBe("analytics");
			}
		});
	});

	test("widgets with no dashboardId fall to the default dashboard", async () => {
		await withServer(async (base) => {
			await fetch(
				`${base}/widgets`,
				json({
					id: "legacy",
					name: "Legacy",
					kind: "stat",
					sql: "SELECT COUNT(*) AS value FROM logs",
					options: { valueField: "value" },
					layout: { x: 0, y: 0, w: 3, h: 2 },
				}),
			);
			const body = await (await fetch(`${base}/dashboards/logs`)).json();
			expect(body.widgets.some((w: { id: string }) => w.id === "legacy")).toBe(true);
		});
	});

	test("creates, updates and deletes a dashboard", async () => {
		await withServer(async (base) => {
			const created = await fetch(
				`${base}/dashboards`,
				json({
					id: "ops",
					name: "Ops",
					variables: [{ name: "namespace", type: "text" }],
				}),
			);
			expect(created.status).toBe(201);
			expect((await created.json()).dashboard.builtin).toBe(false);

			const updated = await fetch(`${base}/dashboards/ops`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Operations" }),
			});
			expect((await updated.json()).dashboard.name).toBe("Operations");

			expect((await fetch(`${base}/dashboards/ops`, { method: "DELETE" })).status).toBe(204);
			expect((await fetch(`${base}/dashboards/ops`)).status).toBe(404);
		});
	});

	test("deleting a dashboard takes its widgets with it", async () => {
		await withServer(async (base) => {
			await fetch(`${base}/dashboards`, json({ id: "ops", name: "Ops" }));
			await fetch(
				`${base}/widgets`,
				json({
					id: "ops-widget",
					name: "Ops widget",
					kind: "stat",
					sql: "SELECT COUNT(*) AS value FROM logs",
					options: { valueField: "value" },
					layout: { x: 0, y: 0, w: 3, h: 2 },
					dashboardId: "ops",
				}),
			);
			await fetch(`${base}/dashboards/ops`, { method: "DELETE" });
			// Otherwise it would silently reappear on the default dashboard.
			expect((await fetch(`${base}/widgets/ops-widget`)).status).toBe(404);
		});
	});

	test("rejects duplicate ids and bad variables", async () => {
		await withServer(async (base) => {
			await fetch(`${base}/dashboards`, json({ id: "ops", name: "Ops" }));
			expect((await fetch(`${base}/dashboards`, json({ id: "ops", name: "Again" }))).status).toBe(
				409,
			);
			const bad = await fetch(
				`${base}/dashboards`,
				json({ id: "ops2", name: "Ops", variables: [{ name: "from", type: "text" }] }),
			);
			expect(bad.status).toBe(400);
			expect((await bad.json()).error).toMatch(/reserved/);
		});
	});

	test("refuses to modify or delete builtins", async () => {
		await withServer(async (base) => {
			const put = await fetch(`${base}/dashboards/logs`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Hijacked" }),
			});
			expect(put.status).toBe(403);
			expect((await fetch(`${base}/dashboards/analytics`, { method: "DELETE" })).status).toBe(403);
		});
	});

	test("reads need the read role, writes need admin", async () => {
		await withServer(
			async (base) => {
				expect((await fetch(`${base}/dashboards`)).status).toBe(401);
				expect(
					(await fetch(`${base}/dashboards`, { headers: { Authorization: "Bearer read-key" } }))
						.status,
				).toBe(200);
				const asRead = await fetch(`${base}/dashboards`, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer read-key" },
					body: JSON.stringify({ id: "ops", name: "Ops" }),
				});
				expect(asRead.status).toBe(403);
				const asAdmin = await fetch(`${base}/dashboards`, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer admin-key" },
					body: JSON.stringify({ id: "ops", name: "Ops" }),
				});
				expect(asAdmin.status).toBe(201);
			},
			{ readKeys: ["read-key"], adminKeys: ["admin-key"] },
		);
	});
});
