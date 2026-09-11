# Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded dashboard in `app/src/views/dashboard.tsx` with a widget-grid system. Every tile is a generic widget defined by `{kind, sql, options, layout}`; the OOTB dashboard ships as seeded "builtin" widgets; the same data model will later back custom SQL widgets and alert rules.

**Architecture:** Server persists widget definitions to `~/.relog/widgets.json` via a `WidgetsManager` mirroring `AggregatesManager`. A `/widgets` HTTP route (GET=read role, mutations=admin role) exposes CRUD. On the client, a filter bar drives global vars (`${from}`, `${to}`, `${service}`, `${project}`); each widget runs its SQL through `/query`, then a per-kind renderer (`stat`, `line`, `bar`, `table`, `status-grid`, `heatmap`, `gauge`, `sparkline`) draws the result. `react-grid-layout` handles drag/resize in edit mode.

**Tech Stack:**

- Server: Bun + TypeScript, SQLite via `bun:sqlite`, existing `handleQuery` + DuckDB reader
- Client: React 19, Vite, Vitest, recharts, CodeMirror 6, react-grid-layout (new dep)
- Tests: `bun test` for server (`test/*.test.ts`); Vitest + jsdom + `@testing-library/react` for client (`src/**/*.vitest.tsx`)
- Lint/format: `bun run lint` (oxlint) + `bun run format` (oxfmt)

**Spec:** `docs/superpowers/specs/2026-04-20-dashboard-v2-design.md`

---

## File Structure

### Server (new/modified)

| File                           | Purpose                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `src/types.ts`                 | Add `Widget`, `WidgetKind`, `WidgetOptions` unions (shared with client via import) |
| `src/paths.ts`                 | Add `getWidgetsPath()`                                                             |
| `src/server/widgets.ts`        | `WidgetsManager` class + `DEFAULT_WIDGETS` seeds                                   |
| `src/server/routes/widgets.ts` | `handleWidgets(request, manager)` CRUD handler                                     |
| `src/server/server.ts`         | Instantiate manager, mount route with auth gating                                  |
| `test/widgets.test.ts`         | Manager CRUD + persistence + default seeding + route tests                         |

### Client (new/modified)

| File                                                   | Purpose                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `app/src/types.ts`                                     | Mirror `Widget`, `WidgetKind`, `WidgetOptions` types                               |
| `app/src/api/client.ts`                                | Add `/widgets` helper (reuse existing `apiGet/Post/Put/Delete`)                    |
| `app/src/hooks/use-widgets.ts`                         | CRUD + local cache hook                                                            |
| `app/src/hooks/use-widget-data.ts`                     | Per-widget query runner (resolve vars → POST `/query` → expose rows/loading/error) |
| `app/src/components/dashboard/sql-vars.ts`             | `substituteVars(sql, vars)`                                                        |
| `app/src/components/dashboard/filter-bar.tsx`          | Time range + service + project + auto-refresh + edit-mode toggle + status badge    |
| `app/src/components/dashboard/widget-grid.tsx`         | `react-grid-layout` wrapper, admin-gated drag/resize, debounced PUT                |
| `app/src/components/dashboard/widget-renderer.tsx`     | `kind` dispatcher + `WidgetError`, `WidgetLoading`, `WidgetEmpty` helpers          |
| `app/src/components/dashboard/widgets/stat.tsx`        | Stat card renderer (big number + delta)                                            |
| `app/src/components/dashboard/widgets/line.tsx`        | Line/area time series                                                              |
| `app/src/components/dashboard/widgets/bar.tsx`         | Horizontal or vertical bar                                                         |
| `app/src/components/dashboard/widgets/table.tsx`       | Rows w/ format hints                                                               |
| `app/src/components/dashboard/widgets/status-grid.tsx` | Per-service colored dots                                                           |
| `app/src/components/dashboard/widgets/heatmap.tsx`     | 2D bucket heatmap                                                                  |
| `app/src/components/dashboard/widgets/gauge.tsx`       | Radial gauge                                                                       |
| `app/src/components/dashboard/widgets/sparkline.tsx`   | Inline mini-line                                                                   |
| `app/src/components/dashboard/widget-editor.tsx`       | Modal: CodeMirror SQL + kind + options + live preview                              |
| `app/src/views/dashboard.tsx`                          | Rewritten as orchestrator                                                          |
| `app/src/components/dashboard/*.vitest.tsx`            | One test file per non-trivial component                                            |

### Dependencies

- `app/package.json` — add `react-grid-layout` (and dev types `@types/react-grid-layout`)

### Files deleted or gutted

- Current body of `app/src/views/dashboard.tsx` replaced wholesale — existing hardcoded `StatCard` + `TimelineStrip` usage moves into widget renderers. The file shrinks to orchestrator glue.

---

## Conventions

- **Indentation**: tabs (match existing codebase — oxfmt enforces)
- **Imports**: use `@/…` alias in client code; `.ts`/`.tsx` extensions omitted in imports per existing style
- **Server tests**: `bun test path/to/file.test.ts` or the full suite with `bun test`
- **Client tests**: `cd app && bun run test -- path/to/file.vitest.tsx` (or just `bun run test` for all)
- **After each task**: run the affected test file and, where touched, `bun run lint` + `bun run format`
- **Commit style**: imperative, concise (existing commits use `feat:` / `chore:` / `docs:` prefixes)

---

## Task 1 — Add Widget types (shared)

**Files:**

- Modify: `src/types.ts` (append after `Aggregate` block at end of file)
- Modify: `app/src/types.ts` (append, keep client-side mirror)

- [ ] **Step 1.1: Append widget types to server `src/types.ts`**

Append at end of file:

```ts
export type WidgetKind =
	"stat" | "line" | "bar" | "table" | "status-grid" | "heatmap" | "gauge" | "sparkline";

export interface StatOptions {
	valueField: string;
	deltaField?: string;
	format?: "number" | "bytes" | "ms" | "percent";
}

export interface LineOptions {
	xField: string;
	yFields: string[];
	yFormat?: "number" | "ms" | "percent";
}

export interface BarOptions {
	categoryField: string;
	valueField: string;
	orientation?: "horizontal" | "vertical";
}

export interface TableColumn {
	field: string;
	label?: string;
	format?: "number" | "bytes" | "ms" | "timestamp";
}

export interface TableOptions {
	columns: TableColumn[];
}

export interface StatusGridOptions {
	labelField: string;
	statusField: string;
	thresholds: { healthy: number; degraded: number };
}

export interface HeatmapOptions {
	xField: string;
	yField: string;
	valueField: string;
}

export interface GaugeOptions {
	valueField: string;
	min?: number;
	max: number;
	thresholds?: { warn: number; crit: number };
}

export interface SparklineOptions {
	xField: string;
	yField: string;
}

export type WidgetOptions =
	| StatOptions
	| LineOptions
	| BarOptions
	| TableOptions
	| StatusGridOptions
	| HeatmapOptions
	| GaugeOptions
	| SparklineOptions;

export interface WidgetLayout {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Widget {
	id: string;
	name: string;
	description?: string;
	kind: WidgetKind;
	sql: string;
	options: WidgetOptions;
	layout: WidgetLayout;
	timeRange?: string;
	createdAt: number;
	updatedAt: number;
	builtin?: boolean;
}

export interface WidgetsFile {
	version: 1;
	widgets: Widget[];
}
```

- [ ] **Step 1.2: Mirror types in `app/src/types.ts`**

Append identical blocks (`WidgetKind` through `WidgetsFile`) to `app/src/types.ts`. Exact same content as Step 1.1 — client imports via `@/types`.

- [ ] **Step 1.3: Run typecheck**

Run (from repo root): `bun run typecheck`
Expected: PASS. If no `typecheck` script exists, run `cd app && bun run build -- --mode=typecheck-only` or `tsc --noEmit -p app/tsconfig.app.json`.

- [ ] **Step 1.4: Commit**

```bash
git add src/types.ts app/src/types.ts
git commit -m "feat(types): add Widget type definitions for dashboard v2"
```

---

## Task 2 — Add `getWidgetsPath()`

**Files:**

- Modify: `src/paths.ts`

- [ ] **Step 2.1: Add function after `getAggregatesPath`**

After line 18 of `src/paths.ts`:

```ts
export function getWidgetsPath(): string {
	return join(getDataDir(), "widgets.json");
}
```

- [ ] **Step 2.2: Extend `test/paths.test.ts` with smoke test**

Append or add a new `describe` block:

```ts
import { getWidgetsPath } from "../src/paths.ts";

test("getWidgetsPath returns path inside data dir", () => {
	const p = getWidgetsPath();
	expect(p).toMatch(/widgets\.json$/);
});
```

(If `test/paths.test.ts` does not yet import from `bun:test`, model imports after its existing structure.)

- [ ] **Step 2.3: Run test**

Run: `bun test test/paths.test.ts`
Expected: all existing tests plus the new one PASS.

- [ ] **Step 2.4: Commit**

```bash
git add src/paths.ts test/paths.test.ts
git commit -m "feat(paths): add getWidgetsPath()"
```

---

## Task 3 — `WidgetsManager` (server)

**Files:**

- Create: `src/server/widgets.ts`
- Create: `test/widgets.test.ts`

- [ ] **Step 3.1: Write the failing persistence test**

Create `test/widgets.test.ts`:

```ts
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
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `bun test test/widgets.test.ts`
Expected: FAIL — `WidgetsManager` not exported from `src/server/widgets.ts`.

- [ ] **Step 3.3: Implement minimal `WidgetsManager`**

Create `src/server/widgets.ts`:

```ts
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { Widget, WidgetsFile } from "../types.ts";

export class WidgetsManager {
	private widgets: Map<string, Widget> = new Map();
	private filePath: string | null;

	constructor(filePath?: string) {
		this.filePath = filePath || null;
	}

	async init(): Promise<void> {
		// Seed defaults first so they exist on a fresh install
		for (const w of DEFAULT_WIDGETS) {
			this.widgets.set(w.id, w);
		}
		if (this.filePath) {
			try {
				const raw = await fs.readFile(this.filePath, "utf-8");
				const parsed = JSON.parse(raw) as WidgetsFile | Widget[];
				const list = Array.isArray(parsed) ? parsed : parsed.widgets;
				for (const w of list) {
					this.widgets.set(w.id, w);
				}
			} catch {
				// missing or invalid file — keep defaults
			}
		}
	}

	async add(widget: Omit<Widget, "createdAt" | "updatedAt">): Promise<Widget> {
		const now = Date.now();
		const w: Widget = { ...widget, createdAt: now, updatedAt: now };
		this.widgets.set(w.id, w);
		await this.persist();
		return w;
	}

	async update(
		id: string,
		updates: Partial<Omit<Widget, "id" | "createdAt">>,
	): Promise<Widget | null> {
		const existing = this.widgets.get(id);
		if (!existing) return null;
		const updated: Widget = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};
		this.widgets.set(id, updated);
		await this.persist();
		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const w = this.widgets.get(id);
		if (!w) return false;
		if (w.builtin) return false;
		this.widgets.delete(id);
		await this.persist();
		return true;
	}

	getAll(): Widget[] {
		return Array.from(this.widgets.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string): Widget | null {
		return this.widgets.get(id) || null;
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			await fs.mkdir(dirname(this.filePath), { recursive: true });
			const body: WidgetsFile = { version: 1, widgets: Array.from(this.widgets.values()) };
			await fs.writeFile(this.filePath, JSON.stringify(body, null, 2));
		} catch (err) {
			console.error("[relog.sh] Failed to persist widgets:", err);
		}
	}
}

// Seeded in Task 4. Placeholder so init() compiles.
export const DEFAULT_WIDGETS: Widget[] = [];
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `bun test test/widgets.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Add update, delete, default-seed tests**

Append to `test/widgets.test.ts`:

```ts
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
	// Inject a builtin directly for this test
	await m.add({ ...makeWidget("bi"), builtin: true });
	expect(await m.delete("bi")).toBe(false);
	expect(m.get("bi")).not.toBeNull();
});
```

- [ ] **Step 3.6: Run tests**

Run: `bun test test/widgets.test.ts`
Expected: all four tests PASS.

- [ ] **Step 3.7: Commit**

```bash
git add src/server/widgets.ts test/widgets.test.ts
git commit -m "feat(server): add WidgetsManager CRUD with JSON persistence"
```

---

## Task 4 — `DEFAULT_WIDGETS` seeds

**Files:**

- Modify: `src/server/widgets.ts` (replace placeholder `DEFAULT_WIDGETS`)
- Modify: `test/widgets.test.ts` (add seeding test)

- [ ] **Step 4.1: Write the failing seed test**

Append to `test/widgets.test.ts`:

```ts
test("init on empty file seeds DEFAULT_WIDGETS", async () => {
	const path = tmpFile();
	created.push(path);
	const m = new WidgetsManager(path);
	await m.init();
	const all = m.getAll();
	expect(all.length).toBeGreaterThanOrEqual(11);
	// Known seed ids
	for (const id of ["total-logs", "error-rate", "errors-over-time", "top-errors"]) {
		expect(m.get(id)).not.toBeNull();
		expect(m.get(id)!.builtin).toBe(true);
	}
});
```

- [ ] **Step 4.2: Run to verify failure**

Run: `bun test test/widgets.test.ts`
Expected: FAIL — no defaults seeded.

- [ ] **Step 4.3: Replace `DEFAULT_WIDGETS` with full seed list**

In `src/server/widgets.ts`, replace the placeholder `export const DEFAULT_WIDGETS: Widget[] = [];` with:

```ts
const BUILTIN_TS = 0; // deterministic createdAt/updatedAt for builtins

export const DEFAULT_WIDGETS: Widget[] = [
	{
		id: "total-logs",
		name: "Total Logs",
		description: "Count of logs in the selected range",
		kind: "stat",
		sql: "SELECT COUNT(*) AS value FROM logs WHERE created_at BETWEEN ${from} AND ${to}",
		options: { valueField: "value", format: "number" },
		layout: { x: 0, y: 0, w: 4, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "db-size",
		name: "Database Size",
		description: "On-disk size of the SQLite database",
		kind: "stat",
		sql: "SELECT page_count * page_size AS value FROM pragma_page_count(), pragma_page_size()",
		options: { valueField: "value", format: "bytes" },
		layout: { x: 4, y: 0, w: 4, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "error-rate",
		name: "Error Rate",
		description: "Percent of logs at error or fatal level",
		kind: "stat",
		sql: `
			SELECT
				CASE WHEN COUNT(*) = 0 THEN 0
				ELSE SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
				END AS value
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
		`,
		options: { valueField: "value", format: "percent" },
		layout: { x: 8, y: 0, w: 4, h: 2 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "log-volume",
		name: "Log Volume",
		description: "Log count per minute bucket",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS INTEGER) * 60000 AS bucket,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["count"], yFormat: "number" },
		layout: { x: 0, y: 2, w: 12, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "errors-over-time",
		name: "Errors Over Time",
		description: "Error+fatal log count per minute bucket",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS INTEGER) * 60000 AS bucket,
				COUNT(*) AS errors
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND level IN ('error','fatal')
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["errors"], yFormat: "number" },
		layout: { x: 0, y: 6, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "throughput",
		name: "Throughput per Service",
		description: "Logs per minute by service",
		kind: "line",
		sql: `
			SELECT
				CAST(created_at / 60000 AS INTEGER) * 60000 AS bucket,
				service,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND service IS NOT NULL
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY bucket, service
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["count"], yFormat: "number" },
		layout: { x: 6, y: 6, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "latency-p50-p95-p99",
		name: "Latency Percentiles",
		description: "p50 / p95 / p99 of wide-event duration_ms per minute",
		kind: "line",
		sql: `
			WITH durations AS (
				SELECT
					CAST(created_at / 60000 AS INTEGER) * 60000 AS bucket,
					CAST(json_extract(meta, '$.duration_ms') AS REAL) AS d
				FROM logs
				WHERE created_at BETWEEN \${from} AND \${to}
					AND json_extract(meta, '$.duration_ms') IS NOT NULL
					AND (\${service} IS NULL OR service = \${service})
					AND (\${project} IS NULL OR project = \${project})
			),
			ranked AS (
				SELECT bucket, d,
					ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY d) AS rn,
					COUNT(*) OVER (PARTITION BY bucket) AS n
				FROM durations
			)
			SELECT bucket,
				MAX(CASE WHEN rn = CAST(n * 0.50 AS INTEGER) + 1 THEN d END) AS p50,
				MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN d END) AS p95,
				MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN d END) AS p99
			FROM ranked
			GROUP BY bucket
			ORDER BY bucket
		`,
		options: { xField: "bucket", yFields: ["p50", "p95", "p99"], yFormat: "ms" },
		layout: { x: 0, y: 10, w: 12, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "service-health",
		name: "Service Health",
		description: "Error percent per service over the selected range",
		kind: "status-grid",
		sql: `
			SELECT
				service,
				CASE WHEN COUNT(*) = 0 THEN 0
				ELSE SUM(CASE WHEN level IN ('error','fatal') THEN 1 ELSE 0 END) * 100.0 / COUNT(*)
				END AS error_pct
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND service IS NOT NULL
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY service
			ORDER BY service
		`,
		options: {
			labelField: "service",
			statusField: "error_pct",
			thresholds: { healthy: 1, degraded: 5 },
		},
		layout: { x: 0, y: 14, w: 12, h: 3 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "project-branch",
		name: "Project × Branch",
		description: "Log count grouped by project and branch",
		kind: "bar",
		sql: `
			SELECT
				COALESCE(project, '—') || ' · ' || COALESCE(branch, '—') AS label,
				COUNT(*) AS count
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND project IS NOT NULL
			GROUP BY project, branch
			ORDER BY count DESC
			LIMIT 15
		`,
		options: { categoryField: "label", valueField: "count", orientation: "horizontal" },
		layout: { x: 0, y: 17, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "top-errors",
		name: "Top Error Messages",
		description: "Most frequent error/fatal messages with last-seen timestamp",
		kind: "table",
		sql: `
			SELECT
				message,
				COUNT(*) AS count,
				MAX(timestamp) AS last_seen
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND level IN ('error','fatal')
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			GROUP BY message
			ORDER BY count DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "message", label: "Message" },
				{ field: "count", label: "Count", format: "number" },
				{ field: "last_seen", label: "Last seen", format: "timestamp" },
			],
		},
		layout: { x: 6, y: 17, w: 6, h: 4 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "slowest-events",
		name: "Slowest Wide Events",
		description: "Wide events with the largest duration_ms",
		kind: "table",
		sql: `
			SELECT
				message,
				service,
				CAST(json_extract(meta, '$.duration_ms') AS REAL) AS duration_ms
			FROM logs
			WHERE created_at BETWEEN \${from} AND \${to}
				AND json_extract(meta, '$.event') = 1
				AND (\${service} IS NULL OR service = \${service})
				AND (\${project} IS NULL OR project = \${project})
			ORDER BY duration_ms DESC
			LIMIT 20
		`,
		options: {
			columns: [
				{ field: "message", label: "Event" },
				{ field: "service", label: "Service" },
				{ field: "duration_ms", label: "Duration", format: "ms" },
			],
		},
		layout: { x: 0, y: 21, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "recent-errors",
		name: "Recent Errors",
		description: "Ten most recent error/fatal logs",
		kind: "table",
		sql: `
			SELECT
				timestamp,
				level,
				service,
				message
			FROM logs
			WHERE level IN ('error','fatal')
			ORDER BY created_at DESC
			LIMIT 10
		`,
		options: {
			columns: [
				{ field: "timestamp", label: "Time", format: "timestamp" },
				{ field: "level", label: "Level" },
				{ field: "service", label: "Service" },
				{ field: "message", label: "Message" },
			],
		},
		layout: { x: 6, y: 21, w: 6, h: 5 },
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
];
```

- [ ] **Step 4.4: Run tests**

Run: `bun test test/widgets.test.ts`
Expected: all tests PASS including the new seed test.

- [ ] **Step 4.5: Run typecheck**

Run: `cd app && bun run build -- --mode=typecheck-only` OR `tsc --noEmit` from repo root.
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add src/server/widgets.ts test/widgets.test.ts
git commit -m "feat(widgets): seed 12 default OOTB widgets with SQL"
```

---

## Task 5 — `/widgets` HTTP route

**Files:**

- Create: `src/server/routes/widgets.ts`
- Modify: `test/widgets.test.ts` (add route tests)

- [ ] **Step 5.1: Write failing route tests**

Append to `test/widgets.test.ts`:

```ts
import { handleWidgets } from "../src/server/routes/widgets.ts";

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
		const body = await res.json();
		expect(Array.isArray(body.widgets)).toBe(true);
		expect(body.widgets.length).toBeGreaterThanOrEqual(11);
	});

	test("POST /widgets creates a widget", async () => {
		const m = new WidgetsManager();
		await m.init();
		const res = await handleWidgets(await req("POST", "/widgets", makeWidget("custom")), m);
		expect(res.status).toBe(201);
		expect(m.get("custom")).not.toBeNull();
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

	test("PUT /widgets/:id updates", async () => {
		const m = new WidgetsManager();
		await m.init();
		await m.add(makeWidget("u"));
		const res = await handleWidgets(await req("PUT", "/widgets/u", { name: "Renamed" }), m);
		expect(res.status).toBe(200);
		expect(m.get("u")!.name).toBe("Renamed");
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
```

- [ ] **Step 5.2: Run to verify failure**

Run: `bun test test/widgets.test.ts`
Expected: FAIL — `handleWidgets` not exported.

- [ ] **Step 5.3: Implement route handler**

Create `src/server/routes/widgets.ts`:

```ts
import type { Widget } from "../../types.ts";
import type { WidgetsManager } from "../widgets.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export async function handleWidgets(
	request: Request,
	widgetsManager: WidgetsManager,
): Promise<Response> {
	const url = new URL(request.url);
	const method = request.method;
	const pathParts = url.pathname.split("/").filter(Boolean);
	const id = pathParts[1]; // /widgets/:id

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
		const widget = await widgetsManager.add({ ...body, builtin: false });
		return Response.json({ widget }, { status: 201 });
	}

	if (method === "PUT") {
		if (!id) return Response.json({ error: "Missing widget ID" }, { status: 400 });
		let body: Partial<Omit<Widget, "id" | "createdAt">>;
		try {
			body = (await request.json()) as Partial<Omit<Widget, "id" | "createdAt">>;
		} catch {
			return Response.json({ error: "Invalid request body" }, { status: 400 });
		}
		const existing = widgetsManager.get(id);
		if (!existing) return Response.json({ error: "Widget not found" }, { status: 404 });
		if (existing.builtin) {
			// Allow layout-only edits on builtins (user repositioning) but block content changes
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
		const updated = await widgetsManager.update(id, body);
		if (!updated) return Response.json({ error: "Widget not found" }, { status: 404 });
		return Response.json({ widget: updated });
	}

	if (method === "DELETE") {
		if (!id) return Response.json({ error: "Missing widget ID" }, { status: 400 });
		const existing = widgetsManager.get(id);
		if (!existing) return Response.json({ error: "Widget not found" }, { status: 404 });
		if (existing.builtin) {
			return Response.json({ error: "Cannot delete builtin widget" }, { status: 403 });
		}
		await widgetsManager.delete(id);
		return Response.json({ success: true });
	}

	return Response.json({ error: "Method not allowed" }, { status: 405 });
}
```

- [ ] **Step 5.4: Run tests**

Run: `bun test test/widgets.test.ts`
Expected: all tests PASS.

- [ ] **Step 5.5: Lint + format**

Run:

```bash
bun run lint
bun run format
```

Expected: clean (ignore pre-existing warnings in files you did not touch).

- [ ] **Step 5.6: Commit**

```bash
git add src/server/routes/widgets.ts test/widgets.test.ts
git commit -m "feat(server): add /widgets CRUD route handler"
```

---

## Task 6 — Wire `/widgets` into server bootstrap

**Files:**

- Modify: `src/server/server.ts`

- [ ] **Step 6.1: Add imports**

At the top of `src/server/server.ts`, next to the existing aggregates imports:

```ts
import { WidgetsManager } from "./widgets.ts";
import { handleWidgets } from "./routes/widgets.ts";
import { getWidgetsPath } from "../paths.ts";
```

(`getWidgetsPath` may already be importable via existing `./paths.ts` barrel — use whichever matches the aggregates import style in the same file.)

- [ ] **Step 6.2: Extend `ServerInstance` interface**

Add `widgetsManager: WidgetsManager;` next to `aggregatesManager`.

- [ ] **Step 6.3: Instantiate in `startServer`**

After the `aggregatesManager.init()` block:

```ts
const widgetsManager = new WidgetsManager(getWidgetsPath());
await widgetsManager.init();
```

- [ ] **Step 6.4: Mount route**

After the `else if (path.startsWith("/aggregates"))` block inside the `fetch` handler, add:

```ts
} else if (path.startsWith("/widgets")) {
	if (method === "GET") {
		auth = checkRole(request, "read", keys, prefixLen);
	} else {
		auth = checkRole(request, "admin", keys, prefixLen);
	}
	if (auth.error) return auth.error;
	response = await handleWidgets(request, widgetsManager);
```

- [ ] **Step 6.5: Return it from `startServer`**

In the return value of `startServer`, include `widgetsManager` alongside `aggregatesManager`.

- [ ] **Step 6.6: Smoke test — server boot**

Run:

```bash
bun run src/cli.ts start --no-ui --no-open &
SERVER_PID=$!
sleep 1
curl -s http://localhost:3485/widgets | head -c 400
kill $SERVER_PID
```

Expected: JSON `{ "widgets": [ … ] }` with seeded ids.

- [ ] **Step 6.7: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): mount /widgets route with read/admin auth"
```

---

## Task 7 — Client `/widgets` API helpers + `useWidgets` hook

**Files:**

- Modify: `app/src/api/client.ts` (no change needed — reuse `apiGet/Post/Put/Delete`)
- Create: `app/src/hooks/use-widgets.ts`

- [ ] **Step 7.1: Create the hook**

Create `app/src/hooks/use-widgets.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "@/api/client";
import type { Widget } from "@/types";

export function useWidgets() {
	const [widgets, setWidgets] = useState<Widget[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiGet<{ widgets: Widget[] }>("/widgets");
			setWidgets(res.widgets ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load widgets");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refetch();
	}, [refetch]);

	const create = useCallback(async (w: Omit<Widget, "createdAt" | "updatedAt">) => {
		const res = await apiPost<{ widget: Widget }>("/widgets", w);
		setWidgets((prev) => [...prev.filter((x) => x.id !== res.widget.id), res.widget]);
		return res.widget;
	}, []);

	const update = useCallback(
		async (id: string, patch: Partial<Omit<Widget, "id" | "createdAt">>) => {
			const res = await apiPut<{ widget: Widget }>(`/widgets/${id}`, patch);
			setWidgets((prev) => prev.map((x) => (x.id === id ? res.widget : x)));
			return res.widget;
		},
		[],
	);

	const remove = useCallback(async (id: string) => {
		await apiDelete(`/widgets/${id}`);
		setWidgets((prev) => prev.filter((x) => x.id !== id));
	}, []);

	return { widgets, loading, error, refetch, create, update, remove };
}
```

- [ ] **Step 7.2: Typecheck**

Run: `cd app && bun run build -- --mode=typecheck-only` (or `tsc --noEmit -p app/tsconfig.app.json`).
Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add app/src/hooks/use-widgets.ts
git commit -m "feat(app): add useWidgets hook for /widgets CRUD"
```

---

## Task 8 — `substituteVars` SQL template

**Files:**

- Create: `app/src/components/dashboard/sql-vars.ts`
- Create: `app/src/components/dashboard/sql-vars.vitest.ts`

- [ ] **Step 8.1: Write failing tests**

Create `app/src/components/dashboard/sql-vars.vitest.ts`:

```ts
import { describe, expect, test } from "vitest";
import { substituteVars } from "./sql-vars";

const VARS = { from: 1000, to: 2000, service: "api", project: "web" };

describe("substituteVars", () => {
	test("substitutes all known vars", () => {
		const out = substituteVars(
			"SELECT * FROM logs WHERE created_at BETWEEN ${from} AND ${to} AND service = ${service} AND project = ${project}",
			VARS,
		);
		expect(out).toBe(
			"SELECT * FROM logs WHERE created_at BETWEEN 1000 AND 2000 AND service = 'api' AND project = 'web'",
		);
	});

	test("unset service substitutes NULL", () => {
		const out = substituteVars("SELECT ${service}", { from: 0, to: 0 });
		expect(out).toBe("SELECT NULL");
	});

	test("escapes single quotes in service name", () => {
		const out = substituteVars("SELECT ${service}", { ...VARS, service: "a'b" });
		expect(out).toBe("SELECT 'a''b'");
	});

	test("unknown placeholder throws", () => {
		expect(() => substituteVars("SELECT ${nope}", VARS)).toThrow(/Unknown placeholder: nope/);
	});

	test("leaves unrelated $ alone", () => {
		expect(substituteVars("SELECT '$100' AS price", VARS)).toBe("SELECT '$100' AS price");
	});

	test("injection in service name stays quoted", () => {
		const out = substituteVars("SELECT ${service}", {
			...VARS,
			service: "'; DROP TABLE logs; --",
		});
		expect(out).toBe("SELECT '''; DROP TABLE logs; --'");
	});
});
```

- [ ] **Step 8.2: Run to verify failure**

Run: `cd app && bun run test sql-vars.vitest.ts`
Expected: FAIL — module not found.

- [ ] **Step 8.3: Implement `substituteVars`**

Create `app/src/components/dashboard/sql-vars.ts`:

```ts
export interface SqlVars {
	from: number;
	to: number;
	service?: string | null;
	project?: string | null;
}

const KNOWN = new Set<keyof SqlVars>(["from", "to", "service", "project"]);
const PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function quote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export function substituteVars(sql: string, vars: SqlVars): string {
	return sql.replace(PLACEHOLDER, (_match, name: string) => {
		if (!KNOWN.has(name as keyof SqlVars)) {
			throw new Error(`Unknown placeholder: ${name}`);
		}
		if (name === "from") return String(Math.floor(vars.from));
		if (name === "to") return String(Math.floor(vars.to));
		const v = vars[name as "service" | "project"];
		if (v == null || v === "") return "NULL";
		return quote(String(v));
	});
}
```

- [ ] **Step 8.4: Run tests**

Run: `cd app && bun run test sql-vars.vitest.ts`
Expected: all tests PASS.

- [ ] **Step 8.5: Commit**

```bash
git add app/src/components/dashboard/sql-vars.ts app/src/components/dashboard/sql-vars.vitest.ts
git commit -m "feat(app): add substituteVars SQL template helper"
```

---

## Task 9 — `useWidgetData` hook

**Files:**

- Create: `app/src/hooks/use-widget-data.ts`

- [ ] **Step 9.1: Implement hook**

Create `app/src/hooks/use-widget-data.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/api/client";
import { substituteVars, type SqlVars } from "@/components/dashboard/sql-vars";
import type { QueryResult, Widget } from "@/types";

const TIME_RANGE_MS: Record<string, number> = {
	"1h": 3_600_000,
	"6h": 21_600_000,
	"24h": 86_400_000,
	"7d": 7 * 86_400_000,
	"30d": 30 * 86_400_000,
};

export const QUERY_TIMEOUT_MS = 15_000;

export interface WidgetFilters {
	timeRange: string; // e.g. "24h"
	service?: string | null;
	project?: string | null;
	nowMs?: number; // for testability
}

export function resolveVars(widget: Widget, filters: WidgetFilters): SqlVars {
	const now = filters.nowMs ?? Date.now();
	const rangeKey = widget.timeRange ?? filters.timeRange;
	const span = TIME_RANGE_MS[rangeKey] ?? TIME_RANGE_MS["24h"];
	return {
		from: now - span,
		to: now,
		service: filters.service ?? null,
		project: filters.project ?? null,
	};
}

export interface WidgetDataState {
	rows: Record<string, unknown>[];
	columns: string[];
	loading: boolean;
	error: string | null;
	reload: () => void;
}

export function useWidgetData(
	widget: Widget,
	filters: WidgetFilters,
	refreshKey: number,
): WidgetDataState {
	const [rows, setRows] = useState<Record<string, unknown>[]>([]);
	const [columns, setColumns] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [tick, setTick] = useState(0);

	const run = useCallback(async () => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
		setLoading(true);
		setError(null);
		try {
			const vars = resolveVars(widget, filters);
			const sql = substituteVars(widget.sql, vars);
			const res = await apiPost<QueryResult>("/query", { sql });
			if (controller.signal.aborted) return;
			const nextRows = res.rows ?? [];
			setRows(nextRows);
			setColumns(nextRows[0] ? Object.keys(nextRows[0]) : []);
		} catch (err) {
			if (controller.signal.aborted) {
				setError("Query timed out");
			} else {
				setError(err instanceof Error ? err.message : "Query failed");
			}
		} finally {
			clearTimeout(timeout);
			if (!controller.signal.aborted || controller.signal.reason === "timeout") {
				setLoading(false);
			} else {
				setLoading(false);
			}
		}
	}, [widget, filters, tick]);

	useEffect(() => {
		run();
		return () => abortRef.current?.abort();
	}, [run, refreshKey]);

	return { rows, columns, loading, error, reload: () => setTick((t) => t + 1) };
}
```

- [ ] **Step 9.2: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 9.3: Commit**

```bash
git add app/src/hooks/use-widget-data.ts
git commit -m "feat(app): add useWidgetData hook with SQL var resolution + timeout"
```

---

## Task 10 — Widget renderer shell (`WidgetRenderer` + error/loading/empty helpers)

**Files:**

- Create: `app/src/components/dashboard/widget-renderer.tsx`

- [ ] **Step 10.1: Implement dispatcher + state helpers**

Create `app/src/components/dashboard/widget-renderer.tsx`:

```tsx
import type { Widget } from "@/types";
import { Loader2 } from "lucide-react";
import { StatWidget } from "./widgets/stat";
import { LineWidget } from "./widgets/line";
import { BarWidget } from "./widgets/bar";
import { TableWidget } from "./widgets/table";
import { StatusGridWidget } from "./widgets/status-grid";
import { HeatmapWidget } from "./widgets/heatmap";
import { GaugeWidget } from "./widgets/gauge";
import { SparklineWidget } from "./widgets/sparkline";

export interface WidgetRenderProps {
	widget: Widget;
	rows: Record<string, unknown>[];
	columns: string[];
	loading: boolean;
	error: string | null;
	onReload?: () => void;
}

export function WidgetRenderer(props: WidgetRenderProps) {
	const { widget, rows, loading, error, onReload } = props;
	if (error) return <WidgetError message={error} onRetry={onReload} />;
	if (loading && rows.length === 0) return <WidgetLoading />;
	if (!loading && rows.length === 0) return <WidgetEmpty />;

	const options = widget.options as never;
	switch (widget.kind) {
		case "stat":
			return <StatWidget rows={rows} options={options} />;
		case "line":
			return <LineWidget rows={rows} options={options} />;
		case "bar":
			return <BarWidget rows={rows} options={options} />;
		case "table":
			return <TableWidget rows={rows} options={options} />;
		case "status-grid":
			return <StatusGridWidget rows={rows} options={options} />;
		case "heatmap":
			return <HeatmapWidget rows={rows} options={options} />;
		case "gauge":
			return <GaugeWidget rows={rows} options={options} />;
		case "sparkline":
			return <SparklineWidget rows={rows} options={options} />;
	}
}

export function WidgetError({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-xs">
			<span className="rounded-sm bg-destructive/10 px-2 py-1 font-medium text-destructive">
				{message}
			</span>
			{onRetry && (
				<button type="button" onClick={onRetry} className="text-muted-foreground underline">
					Retry
				</button>
			)}
		</div>
	);
}

export function WidgetLoading() {
	return (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
		</div>
	);
}

export function WidgetEmpty() {
	return (
		<div className="flex h-full items-center justify-center">
			<span className="text-xs italic text-muted-foreground">No data</span>
		</div>
	);
}
```

- [ ] **Step 10.2: Typecheck (will fail until Task 11 renderers exist)**

Defer typecheck until Task 11 is complete (renderers imported here are created there).

---

## Task 11 — Kind-specific renderers

**Files:**

- Create: `app/src/components/dashboard/widgets/stat.tsx`
- Create: `app/src/components/dashboard/widgets/line.tsx`
- Create: `app/src/components/dashboard/widgets/bar.tsx`
- Create: `app/src/components/dashboard/widgets/table.tsx`
- Create: `app/src/components/dashboard/widgets/status-grid.tsx`
- Create: `app/src/components/dashboard/widgets/heatmap.tsx`
- Create: `app/src/components/dashboard/widgets/gauge.tsx`
- Create: `app/src/components/dashboard/widgets/sparkline.tsx`
- Create: `app/src/components/dashboard/widgets/format.ts`

- [ ] **Step 11.1: Value formatters**

Create `app/src/components/dashboard/widgets/format.ts`:

```ts
export type ValueFormat = "number" | "bytes" | "ms" | "percent" | "timestamp";

export function formatValue(v: unknown, fmt: ValueFormat | undefined): string {
	if (v == null) return "—";
	const n = typeof v === "number" ? v : Number(v);
	if (!fmt || fmt === "number") {
		if (!Number.isFinite(n)) return String(v);
		return n.toLocaleString();
	}
	if (fmt === "bytes") {
		if (!Number.isFinite(n)) return String(v);
		if (n < 1024) return `${n} B`;
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return `${(n / 1024 ** 3).toFixed(2)} GB`;
	}
	if (fmt === "ms") {
		if (!Number.isFinite(n)) return String(v);
		if (n < 1) return `${n.toFixed(2)} ms`;
		if (n < 1000) return `${n.toFixed(1)} ms`;
		return `${(n / 1000).toFixed(2)} s`;
	}
	if (fmt === "percent") {
		if (!Number.isFinite(n)) return String(v);
		return `${n.toFixed(2)}%`;
	}
	if (fmt === "timestamp") {
		const d = typeof v === "string" ? new Date(v) : new Date(n);
		return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-US", { hour12: false });
	}
	return String(v);
}
```

- [ ] **Step 11.2: Stat renderer**

Create `app/src/components/dashboard/widgets/stat.tsx`:

```tsx
import type { StatOptions } from "@/types";
import { formatValue } from "./format";
import { WidgetError } from "../widget-renderer";

export function StatWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: StatOptions;
}) {
	const row = rows[0];
	if (!row || !(options.valueField in row)) {
		return <WidgetError message={`Missing column: ${options.valueField}`} />;
	}
	const value = formatValue(row[options.valueField], options.format ?? "number");
	const delta =
		options.deltaField && options.deltaField in row
			? formatValue(row[options.deltaField], options.format ?? "number")
			: null;
	return (
		<div className="flex h-full flex-col justify-center gap-1 p-3">
			<div className="text-2xl font-semibold tabular-nums">{value}</div>
			{delta && <div className="text-xs text-muted-foreground">Δ {delta}</div>}
		</div>
	);
}
```

- [ ] **Step 11.3: Line renderer**

Create `app/src/components/dashboard/widgets/line.tsx`:

```tsx
import type { LineOptions } from "@/types";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatValue } from "./format";
import { WidgetError } from "../widget-renderer";

const LINE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];

export function LineWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: LineOptions;
}) {
	if (rows.length && !(options.xField in rows[0])) {
		return <WidgetError message={`Missing x column: ${options.xField}`} />;
	}
	const missingY = options.yFields.find((f) => rows.length && !(f in rows[0]));
	if (missingY) return <WidgetError message={`Missing y column: ${missingY}`} />;

	return (
		<div className="h-full w-full p-1">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
					<CartesianGrid stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
					<XAxis
						dataKey={options.xField}
						tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
						axisLine={false}
						tickLine={false}
						tickFormatter={(v) => formatValue(v, "timestamp").replace(/.* /, "")}
					/>
					<YAxis
						tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
						axisLine={false}
						tickLine={false}
						width={40}
						tickFormatter={(v) => formatValue(v, options.yFormat ?? "number")}
					/>
					<Tooltip
						contentStyle={{
							fontSize: 11,
							background: "var(--color-popover)",
							border: "1px solid var(--color-border)",
							borderRadius: 6,
						}}
						labelFormatter={(v) => formatValue(v, "timestamp")}
						formatter={(v: unknown) => formatValue(v, options.yFormat ?? "number")}
					/>
					{options.yFields.map((f, i) => (
						<Line
							key={f}
							type="monotone"
							dataKey={f}
							stroke={LINE_COLORS[i % LINE_COLORS.length]}
							strokeWidth={2}
							dot={false}
							isAnimationActive={false}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
```

- [ ] **Step 11.4: Bar renderer**

Create `app/src/components/dashboard/widgets/bar.tsx`:

```tsx
import type { BarOptions } from "@/types";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WidgetError } from "../widget-renderer";

export function BarWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: BarOptions;
}) {
	if (rows.length && (!(options.categoryField in rows[0]) || !(options.valueField in rows[0]))) {
		return (
			<WidgetError message={`Missing column: ${options.categoryField} or ${options.valueField}`} />
		);
	}
	const horizontal = options.orientation !== "vertical";
	return (
		<div className="h-full w-full p-1">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={rows}
					layout={horizontal ? "vertical" : "horizontal"}
					margin={{ top: 4, right: 8, bottom: 0, left: horizontal ? 60 : 0 }}
				>
					{horizontal ? (
						<>
							<XAxis type="number" hide />
							<YAxis
								type="category"
								dataKey={options.categoryField}
								tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
								axisLine={false}
								tickLine={false}
								width={55}
							/>
						</>
					) : (
						<>
							<XAxis
								dataKey={options.categoryField}
								tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
						</>
					)}
					<Tooltip
						contentStyle={{
							fontSize: 11,
							background: "var(--color-popover)",
							border: "1px solid var(--color-border)",
							borderRadius: 6,
						}}
					/>
					<Bar
						dataKey={options.valueField}
						fill="var(--color-primary)"
						fillOpacity={0.6}
						radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
					>
						{rows.map((_, i) => (
							<Cell key={i} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
```

- [ ] **Step 11.5: Table renderer**

Create `app/src/components/dashboard/widgets/table.tsx`:

```tsx
import type { TableOptions } from "@/types";
import { formatValue } from "./format";

export function TableWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: TableOptions;
}) {
	return (
		<div className="h-full overflow-auto p-1">
			<table className="w-full text-xs">
				<thead className="sticky top-0 bg-background">
					<tr className="border-b border-border">
						{options.columns.map((c) => (
							<th key={c.field} className="px-2 py-1 text-left font-medium text-muted-foreground">
								{c.label ?? c.field}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="border-b border-border/40">
							{options.columns.map((c) => (
								<td key={c.field} className="truncate px-2 py-1 tabular-nums">
									{formatValue(row[c.field], c.format)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
```

- [ ] **Step 11.6: Status grid renderer**

Create `app/src/components/dashboard/widgets/status-grid.tsx`:

```tsx
import type { StatusGridOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

function statusColor(v: number, thresholds: { healthy: number; degraded: number }): string {
	if (!Number.isFinite(v)) return "bg-muted";
	if (v <= thresholds.healthy) return "bg-emerald-500";
	if (v <= thresholds.degraded) return "bg-amber-500";
	return "bg-red-500";
}

export function StatusGridWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: StatusGridOptions;
}) {
	if (rows.length && (!(options.labelField in rows[0]) || !(options.statusField in rows[0]))) {
		return (
			<WidgetError message={`Missing column: ${options.labelField} or ${options.statusField}`} />
		);
	}
	return (
		<div className="grid h-full grid-cols-4 gap-2 p-3 sm:grid-cols-6 md:grid-cols-8">
			{rows.map((r, i) => {
				const value = Number(r[options.statusField]);
				const color = statusColor(value, options.thresholds);
				return (
					<div
						key={i}
						className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-xs"
						title={`${r[options.labelField]}: ${value.toFixed(2)}%`}
					>
						<span className={`h-3 w-3 rounded-full ${color}`} />
						<span className="truncate font-medium">{String(r[options.labelField])}</span>
						<span className="text-muted-foreground tabular-nums">{value.toFixed(2)}%</span>
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 11.7: Heatmap renderer (minimal)**

Create `app/src/components/dashboard/widgets/heatmap.tsx`:

```tsx
import type { HeatmapOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

export function HeatmapWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: HeatmapOptions;
}) {
	if (
		rows.length &&
		(!(options.xField in rows[0]) ||
			!(options.yField in rows[0]) ||
			!(options.valueField in rows[0]))
	) {
		return <WidgetError message="Missing x/y/value column" />;
	}
	const xs = Array.from(new Set(rows.map((r) => String(r[options.xField])))).sort();
	const ys = Array.from(new Set(rows.map((r) => String(r[options.yField])))).sort();
	const max = rows.reduce((m, r) => Math.max(m, Number(r[options.valueField]) || 0), 0) || 1;
	const cellMap = new Map<string, number>();
	for (const r of rows) {
		cellMap.set(`${r[options.xField]}::${r[options.yField]}`, Number(r[options.valueField]) || 0);
	}
	return (
		<div className="h-full w-full overflow-auto p-2">
			<div
				className="grid gap-0.5"
				style={{ gridTemplateColumns: `auto repeat(${xs.length}, minmax(10px, 1fr))` }}
			>
				<div />
				{xs.map((x) => (
					<div key={x} className="truncate text-[10px] text-muted-foreground">
						{x}
					</div>
				))}
				{ys.map((y) => (
					<>
						<div key={y} className="truncate pr-1 text-[10px] text-muted-foreground">
							{y}
						</div>
						{xs.map((x) => {
							const v = cellMap.get(`${x}::${y}`) ?? 0;
							const intensity = v / max;
							return (
								<div
									key={`${x}-${y}`}
									className="h-4 rounded-sm"
									style={{ background: `rgba(96, 165, 250, ${0.15 + intensity * 0.75})` }}
									title={`${x} · ${y}: ${v}`}
								/>
							);
						})}
					</>
				))}
			</div>
		</div>
	);
}
```

- [ ] **Step 11.8: Gauge renderer**

Create `app/src/components/dashboard/widgets/gauge.tsx`:

```tsx
import type { GaugeOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

export function GaugeWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: GaugeOptions;
}) {
	const row = rows[0];
	if (!row || !(options.valueField in row)) {
		return <WidgetError message={`Missing column: ${options.valueField}`} />;
	}
	const value = Number(row[options.valueField]);
	const min = options.min ?? 0;
	const pct = Math.max(0, Math.min(1, (value - min) / (options.max - min || 1)));
	let color = "#34d399";
	if (options.thresholds && value >= options.thresholds.crit) color = "#f87171";
	else if (options.thresholds && value >= options.thresholds.warn) color = "#fbbf24";

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-3">
			<div className="relative h-20 w-20">
				<svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
					<circle cx="18" cy="18" r="16" fill="none" stroke="var(--color-border)" strokeWidth="3" />
					<circle
						cx="18"
						cy="18"
						r="16"
						fill="none"
						stroke={color}
						strokeWidth="3"
						strokeDasharray={`${pct * 100.5} ${100.5}`}
						strokeLinecap="round"
					/>
				</svg>
				<div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
					{value.toFixed(0)}
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 11.9: Sparkline renderer**

Create `app/src/components/dashboard/widgets/sparkline.tsx`:

```tsx
import type { SparklineOptions } from "@/types";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { WidgetError } from "../widget-renderer";

export function SparklineWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: SparklineOptions;
}) {
	if (rows.length && (!(options.xField in rows[0]) || !(options.yField in rows[0]))) {
		return <WidgetError message={`Missing column: ${options.xField} or ${options.yField}`} />;
	}
	return (
		<div className="h-full w-full p-2">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={rows}>
					<Line
						type="monotone"
						dataKey={options.yField}
						stroke="#60a5fa"
						strokeWidth={2}
						dot={false}
						isAnimationActive={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
```

- [ ] **Step 11.10: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 11.11: Commit**

```bash
git add app/src/components/dashboard/widgets app/src/components/dashboard/widget-renderer.tsx
git commit -m "feat(app): add 8 kind-specific widget renderers + WidgetRenderer dispatcher"
```

---

## Task 12 — Widget renderer test

**Files:**

- Create: `app/src/components/dashboard/widget-renderer.vitest.tsx`

- [ ] **Step 12.1: Write renderer dispatch test**

Create `app/src/components/dashboard/widget-renderer.vitest.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Widget } from "@/types";
import { WidgetRenderer } from "./widget-renderer";

function widgetOf(kind: Widget["kind"], opts: object): Widget {
	return {
		id: "w",
		name: "w",
		kind,
		sql: "",
		options: opts as Widget["options"],
		layout: { x: 0, y: 0, w: 4, h: 2 },
		createdAt: 0,
		updatedAt: 0,
	};
}

describe("WidgetRenderer", () => {
	test("shows error state", () => {
		const w = widgetOf("stat", { valueField: "v" });
		render(<WidgetRenderer widget={w} rows={[]} columns={[]} loading={false} error="boom" />);
		expect(screen.getByText("boom")).toBeInTheDocument();
	});

	test("shows empty state on zero rows", () => {
		const w = widgetOf("stat", { valueField: "v" });
		render(<WidgetRenderer widget={w} rows={[]} columns={[]} loading={false} error={null} />);
		expect(screen.getByText(/no data/i)).toBeInTheDocument();
	});

	test("stat widget missing field renders error", () => {
		const w = widgetOf("stat", { valueField: "nope" });
		render(
			<WidgetRenderer
				widget={w}
				rows={[{ other: 1 }]}
				columns={["other"]}
				loading={false}
				error={null}
			/>,
		);
		expect(screen.getByText(/missing column: nope/i)).toBeInTheDocument();
	});

	test("stat widget renders formatted number", () => {
		const w = widgetOf("stat", { valueField: "v", format: "number" });
		render(
			<WidgetRenderer
				widget={w}
				rows={[{ v: 1234 }]}
				columns={["v"]}
				loading={false}
				error={null}
			/>,
		);
		expect(screen.getByText("1,234")).toBeInTheDocument();
	});
});
```

- [ ] **Step 12.2: Run**

Run: `cd app && bun run test widget-renderer.vitest.tsx`
Expected: PASS.

- [ ] **Step 12.3: Commit**

```bash
git add app/src/components/dashboard/widget-renderer.vitest.tsx
git commit -m "test(app): add WidgetRenderer dispatch + error-state tests"
```

---

## Task 13 — Install `react-grid-layout`

**Files:**

- Modify: `app/package.json`

- [ ] **Step 13.1: Install**

Run:

```bash
cd app && bun add react-grid-layout && bun add -d @types/react-grid-layout
```

Expected: installs, updates `app/package.json` and `app/bun.lock`.

- [ ] **Step 13.2: Commit**

```bash
git add app/package.json app/bun.lock
git commit -m "chore(app): add react-grid-layout"
```

---

## Task 14 — `WidgetGrid`

**Files:**

- Create: `app/src/components/dashboard/widget-grid.tsx`

- [ ] **Step 14.1: Implement grid**

Create `app/src/components/dashboard/widget-grid.tsx`:

```tsx
import { useCallback, useEffect, useRef } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { Widget } from "@/types";

const COLS = 12;
const ROW_HEIGHT = 60;

export interface WidgetGridProps {
	widgets: Widget[];
	editMode: boolean;
	width: number;
	onLayoutChange: (updates: { id: string; layout: Widget["layout"] }[]) => void;
	renderWidget: (w: Widget) => React.ReactNode;
}

export function WidgetGrid({
	widgets,
	editMode,
	width,
	onLayoutChange,
	renderWidget,
}: WidgetGridProps) {
	const pendingRef = useRef<Map<string, Widget["layout"]>>(new Map());
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const flush = useCallback(() => {
		if (pendingRef.current.size === 0) return;
		const updates = Array.from(pendingRef.current.entries()).map(([id, layout]) => ({
			id,
			layout,
		}));
		pendingRef.current.clear();
		onLayoutChange(updates);
	}, [onLayoutChange]);

	useEffect(() => {
		if (!editMode) flush();
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [editMode, flush]);

	const handleLayoutChange = useCallback(
		(layouts: Layout[]) => {
			if (!editMode) return;
			const byId = new Map(widgets.map((w) => [w.id, w]));
			for (const l of layouts) {
				const prev = byId.get(l.i);
				if (!prev) continue;
				if (
					prev.layout.x !== l.x ||
					prev.layout.y !== l.y ||
					prev.layout.w !== l.w ||
					prev.layout.h !== l.h
				) {
					pendingRef.current.set(l.i, { x: l.x, y: l.y, w: l.w, h: l.h });
				}
			}
			if (debounceRef.current) clearTimeout(debounceRef.current);
			debounceRef.current = setTimeout(flush, 2000);
		},
		[widgets, editMode, flush],
	);

	const layout: Layout[] = widgets.map((w) => ({
		i: w.id,
		x: w.layout.x,
		y: w.layout.y,
		w: w.layout.w,
		h: w.layout.h,
		minW: 2,
		minH: 2,
	}));

	return (
		<GridLayout
			className="layout"
			layout={layout}
			cols={COLS}
			rowHeight={ROW_HEIGHT}
			width={width}
			isDraggable={editMode}
			isResizable={editMode}
			onLayoutChange={handleLayoutChange}
			compactType="vertical"
			margin={[12, 12]}
			draggableCancel=".widget-no-drag"
		>
			{widgets.map((w) => (
				<div key={w.id} className="overflow-hidden rounded-lg border border-border bg-card">
					{renderWidget(w)}
				</div>
			))}
		</GridLayout>
	);
}
```

- [ ] **Step 14.2: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 14.3: Commit**

```bash
git add app/src/components/dashboard/widget-grid.tsx
git commit -m "feat(app): add WidgetGrid wrapper around react-grid-layout with debounced PUT"
```

---

## Task 15 — `FilterBar`

**Files:**

- Create: `app/src/components/dashboard/filter-bar.tsx`

- [ ] **Step 15.1: Implement filter bar**

Create `app/src/components/dashboard/filter-bar.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Loader2, Lock, Pencil, Plus, RefreshCw } from "lucide-react";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

export const TIME_RANGES = [
	{ label: "1h", ms: 3_600_000 },
	{ label: "6h", ms: 21_600_000 },
	{ label: "24h", ms: 86_400_000 },
	{ label: "7d", ms: 7 * 86_400_000 },
	{ label: "30d", ms: 30 * 86_400_000 },
];

export const REFRESH_OPTIONS = [
	{ label: "Off", ms: 0 },
	{ label: "10s", ms: 10_000 },
	{ label: "30s", ms: 30_000 },
	{ label: "60s", ms: 60_000 },
];

export interface FilterBarProps {
	timeRange: string;
	onTimeRange: (label: string) => void;
	service: string | null;
	onService: (s: string | null) => void;
	project: string | null;
	onProject: (p: string | null) => void;
	refreshMs: number;
	onRefreshMs: (ms: number) => void;
	loading: boolean;
	onManualRefresh: () => void;
	editMode: boolean;
	onEditMode: (v: boolean) => void;
	onAddWidget: () => void;
	canEdit: boolean;
	status: { ok: boolean; uptime: number } | null;
}

function formatUptime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function FilterBar(props: FilterBarProps) {
	const [services, setServices] = useState<string[]>([]);
	const [projects, setProjects] = useState<string[]>([]);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			apiPost<QueryResult>("/query", {
				sql: "SELECT DISTINCT service FROM logs WHERE service IS NOT NULL ORDER BY service LIMIT 500",
			}),
			apiPost<QueryResult>("/query", {
				sql: "SELECT DISTINCT project FROM logs WHERE project IS NOT NULL ORDER BY project LIMIT 500",
			}),
		])
			.then(([s, p]) => {
				if (cancelled) return;
				setServices(s.rows.map((r) => String(r.service)));
				setProjects(p.rows.map((r) => String(r.project)));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
				{TIME_RANGES.map((tr) => (
					<button
						key={tr.label}
						type="button"
						onClick={() => props.onTimeRange(tr.label)}
						className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
							props.timeRange === tr.label
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{tr.label}
					</button>
				))}
			</div>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.service ?? ""}
				onChange={(e) => props.onService(e.target.value || null)}
			>
				<option value="">All services</option>
				{services.map((s) => (
					<option key={s} value={s}>
						{s}
					</option>
				))}
			</select>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.project ?? ""}
				onChange={(e) => props.onProject(e.target.value || null)}
			>
				<option value="">All projects</option>
				{projects.map((p) => (
					<option key={p} value={p}>
						{p}
					</option>
				))}
			</select>

			<div className="flex-1" />

			{props.status && (
				<span className="text-xs text-muted-foreground">
					{props.status.ok ? "online" : "degraded"} · {formatUptime(props.status.uptime)}
				</span>
			)}

			{props.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}

			<button
				type="button"
				onClick={props.onManualRefresh}
				className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label="Refresh"
			>
				<RefreshCw className="h-3.5 w-3.5" />
			</button>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.refreshMs}
				onChange={(e) => props.onRefreshMs(Number(e.target.value))}
			>
				{REFRESH_OPTIONS.map((o) => (
					<option key={o.label} value={o.ms}>
						Auto: {o.label}
					</option>
				))}
			</select>

			{props.canEdit && (
				<>
					<button
						type="button"
						onClick={() => props.onEditMode(!props.editMode)}
						className={`flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs ${
							props.editMode ? "bg-primary/10 text-primary" : "text-muted-foreground"
						}`}
					>
						{props.editMode ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
						{props.editMode ? "Editing" : "Locked"}
					</button>
					{props.editMode && (
						<button
							type="button"
							onClick={props.onAddWidget}
							className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
						>
							<Plus className="h-3 w-3" /> Add widget
						</button>
					)}
				</>
			)}
		</div>
	);
}
```

- [ ] **Step 15.2: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 15.3: Commit**

```bash
git add app/src/components/dashboard/filter-bar.tsx
git commit -m "feat(app): add dashboard FilterBar with service/project pickers + edit toggle"
```

---

## Task 16 — `WidgetEditor` modal

**Files:**

- Create: `app/src/components/dashboard/widget-editor.tsx`

- [ ] **Step 16.1: Implement editor**

Create `app/src/components/dashboard/widget-editor.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { sql, SQLite } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { X } from "lucide-react";
import type { Widget, WidgetKind, WidgetOptions } from "@/types";
import { substituteVars } from "./sql-vars";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";
import { WidgetRenderer } from "./widget-renderer";

const KINDS: { value: WidgetKind; label: string }[] = [
	{ value: "stat", label: "Stat" },
	{ value: "line", label: "Line" },
	{ value: "bar", label: "Bar" },
	{ value: "table", label: "Table" },
	{ value: "status-grid", label: "Status grid" },
	{ value: "heatmap", label: "Heatmap" },
	{ value: "gauge", label: "Gauge" },
	{ value: "sparkline", label: "Sparkline" },
];

const DEFAULT_OPTIONS: Record<WidgetKind, WidgetOptions> = {
	stat: { valueField: "value", format: "number" },
	line: { xField: "bucket", yFields: ["value"] },
	bar: { categoryField: "label", valueField: "value" },
	table: { columns: [{ field: "value" }] },
	"status-grid": {
		labelField: "label",
		statusField: "value",
		thresholds: { healthy: 1, degraded: 5 },
	},
	heatmap: { xField: "x", yField: "y", valueField: "value" },
	gauge: { valueField: "value", max: 100 },
	sparkline: { xField: "x", yField: "value" },
};

export interface WidgetEditorProps {
	initial?: Widget;
	filterFrom: number;
	filterTo: number;
	service: string | null;
	project: string | null;
	onSave: (w: Omit<Widget, "createdAt" | "updatedAt">) => Promise<void>;
	onCancel: () => void;
}

export function WidgetEditor(props: WidgetEditorProps) {
	const [id, setId] = useState(props.initial?.id ?? "");
	const [name, setName] = useState(props.initial?.name ?? "");
	const [description, setDescription] = useState(props.initial?.description ?? "");
	const [kind, setKind] = useState<WidgetKind>(props.initial?.kind ?? "stat");
	const [options, setOptions] = useState<WidgetOptions>(
		props.initial?.options ?? DEFAULT_OPTIONS.stat,
	);
	const [sqlText, setSqlText] = useState(
		props.initial?.sql ??
			"SELECT COUNT(*) AS value FROM logs WHERE created_at BETWEEN ${from} AND ${to}",
	);
	const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
	const [previewCols, setPreviewCols] = useState<string[]>([]);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const editorHost = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);

	const previewWidget: Widget = useMemo(
		() => ({
			id: id || "preview",
			name: name || "Preview",
			kind,
			sql: sqlText,
			options,
			layout: { x: 0, y: 0, w: 6, h: 4 },
			createdAt: 0,
			updatedAt: 0,
		}),
		[id, name, kind, sqlText, options],
	);

	// Mount CodeMirror once
	useEffect(() => {
		if (!editorHost.current) return;
		const state = EditorState.create({
			doc: sqlText,
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				sql({ dialect: SQLite }),
				oneDark,
				EditorView.updateListener.of((u) => {
					if (u.docChanged) setSqlText(u.state.doc.toString());
				}),
			],
		});
		viewRef.current = new EditorView({ state, parent: editorHost.current });
		return () => viewRef.current?.destroy();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Debounced preview
	useEffect(() => {
		const t = setTimeout(async () => {
			setPreviewLoading(true);
			setPreviewError(null);
			try {
				const resolved = substituteVars(sqlText, {
					from: props.filterFrom,
					to: props.filterTo,
					service: props.service,
					project: props.project,
				});
				const res = await apiPost<QueryResult>("/query", { sql: resolved });
				setPreviewRows(res.rows ?? []);
				setPreviewCols(res.rows?.[0] ? Object.keys(res.rows[0]) : []);
			} catch (err) {
				setPreviewError(err instanceof Error ? err.message : "Preview failed");
			} finally {
				setPreviewLoading(false);
			}
		}, 500);
		return () => clearTimeout(t);
	}, [sqlText, props.filterFrom, props.filterTo, props.service, props.project]);

	const handleKindChange = useCallback((k: WidgetKind) => {
		setKind(k);
		setOptions(DEFAULT_OPTIONS[k]);
	}, []);

	const save = useCallback(async () => {
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
			setPreviewError("Invalid id — use letters, digits, _ or -");
			return;
		}
		if (!name.trim()) {
			setPreviewError("Name required");
			return;
		}
		await props.onSave({
			id,
			name,
			description: description || undefined,
			kind,
			sql: sqlText,
			options,
			layout: props.initial?.layout ?? { x: 0, y: 0, w: 6, h: 4 },
			timeRange: props.initial?.timeRange,
			builtin: false,
		});
	}, [id, name, description, kind, sqlText, options, props]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
			<div className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
				<div className="flex items-center justify-between border-b border-border p-3">
					<h2 className="text-sm font-semibold">{props.initial ? "Edit widget" : "New widget"}</h2>
					<button type="button" onClick={props.onCancel} className="rounded p-1 hover:bg-muted">
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="grid flex-1 grid-cols-2 overflow-hidden">
					<div className="flex flex-col gap-3 overflow-auto border-r border-border p-4 text-xs">
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">ID</span>
							<input
								disabled={!!props.initial}
								value={id}
								onChange={(e) => setId(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Name</span>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Description</span>
							<input
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1"
							/>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Kind</span>
							<select
								value={kind}
								onChange={(e) => handleKindChange(e.target.value as WidgetKind)}
								className="rounded-md border border-border bg-background px-2 py-1"
							>
								{KINDS.map((k) => (
									<option key={k.value} value={k.value}>
										{k.label}
									</option>
								))}
							</select>
						</label>
						<div className="flex flex-col gap-1">
							<span className="text-muted-foreground">SQL</span>
							<div
								ref={editorHost}
								className="min-h-[220px] overflow-hidden rounded-md border border-border"
							/>
							<span className="text-[10px] text-muted-foreground">
								Vars: ${"{"}from{"}"} ${"{"}to{"}"} ${"{"}service{"}"} ${"{"}project{"}"}
							</span>
						</div>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Options (JSON)</span>
							<textarea
								value={JSON.stringify(options, null, 2)}
								onChange={(e) => {
									try {
										setOptions(JSON.parse(e.target.value));
									} catch {
										/* keep typing */
									}
								}}
								rows={6}
								className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
							/>
							<span className="text-[10px] text-muted-foreground">
								Available columns: {previewCols.join(", ") || "—"}
							</span>
						</label>
						{previewError && (
							<div className="rounded-sm bg-destructive/10 px-2 py-1 text-destructive">
								{previewError}
							</div>
						)}
						<div className="mt-auto flex items-center gap-2">
							<button
								type="button"
								onClick={props.onCancel}
								className="rounded-md border border-border px-3 py-1.5"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={save}
								className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
							>
								Save
							</button>
						</div>
					</div>
					<div className="flex flex-col overflow-auto p-4">
						<div className="mb-2 text-xs text-muted-foreground">
							Preview {previewLoading && "· loading…"}
						</div>
						<div className="min-h-[200px] flex-1 overflow-hidden rounded-lg border border-border bg-card">
							<WidgetRenderer
								widget={previewWidget}
								rows={previewRows}
								columns={previewCols}
								loading={previewLoading}
								error={previewError}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 16.2: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 16.3: Commit**

```bash
git add app/src/components/dashboard/widget-editor.tsx
git commit -m "feat(app): add WidgetEditor modal with CodeMirror SQL + live preview"
```

---

## Task 17 — Rewrite `dashboard.tsx` orchestrator

**Files:**

- Modify: `app/src/views/dashboard.tsx` (replace entire body)

- [ ] **Step 17.1: Replace `dashboard.tsx`**

Replace the full contents of `app/src/views/dashboard.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useHealth } from "@/hooks/use-health";
import { useWidgets } from "@/hooks/use-widgets";
import { useWidgetData } from "@/hooks/use-widget-data";
import { FilterBar, TIME_RANGES } from "@/components/dashboard/filter-bar";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { WidgetEditor } from "@/components/dashboard/widget-editor";
import type { Widget } from "@/types";
import { Loader2, Pencil, Copy, EyeOff, Trash2 } from "lucide-react";

const HIDDEN_KEY = "relog:hidden-widgets";

function readHidden(): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[]);
	} catch {
		return new Set();
	}
}

function writeHidden(set: Set<string>): void {
	localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(set)));
}

export function DashboardView({ enabled }: { enabled: boolean }) {
	const { widgets, loading: widgetsLoading, create, update, remove, refetch } = useWidgets();
	const [timeRangeLabel, setTimeRangeLabel] = useHashParam("range", "24h");
	const [service, setService] = useHashParam("service", "");
	const [project, setProject] = useHashParam("project", "");
	const [refreshMsStr, setRefreshMsStr] = useHashParam("refresh", "0");
	const [editMode, setEditMode] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const [hidden, setHidden] = useState<Set<string>>(() => readHidden());
	const [editor, setEditor] = useState<{ open: true; widget?: Widget } | { open: false }>({
		open: false,
	});
	const gridContainerRef = useRef<HTMLDivElement | null>(null);
	const [gridWidth, setGridWidth] = useState(1200);

	const refreshMs = parseInt(refreshMsStr ?? "0", 10);
	const timeRange = TIME_RANGES.find((t) => t.label === timeRangeLabel) ?? TIME_RANGES[2];
	const now = Date.now();
	const filterFrom = now - timeRange.ms;
	const filterTo = now;

	const { data: health } = useHealth(enabled, 15_000);

	// ResizeObserver to keep grid width in sync
	useEffect(() => {
		if (!gridContainerRef.current) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) setGridWidth(e.contentRect.width);
		});
		ro.observe(gridContainerRef.current);
		return () => ro.disconnect();
	}, []);

	// Auto-refresh
	useEffect(() => {
		if (!refreshMs) return;
		const t = setInterval(() => setRefreshKey((k) => k + 1), refreshMs);
		return () => clearInterval(t);
	}, [refreshMs]);

	const visibleWidgets = useMemo(() => widgets.filter((w) => !hidden.has(w.id)), [widgets, hidden]);

	const handleLayoutChange = useCallback(
		(updates: { id: string; layout: Widget["layout"] }[]) => {
			for (const { id, layout } of updates) {
				update(id, { layout }).catch(() => {});
			}
		},
		[update],
	);

	const toggleHidden = useCallback((id: string) => {
		setHidden((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			writeHidden(next);
			return next;
		});
	}, []);

	const handleDuplicate = useCallback((w: Widget) => {
		setEditor({ open: true, widget: { ...w, id: "", builtin: false, createdAt: 0, updatedAt: 0 } });
	}, []);

	const handleDelete = useCallback(
		async (w: Widget) => {
			if (w.builtin) return;
			if (!confirm(`Delete widget "${w.name}"?`)) return;
			await remove(w.id);
		},
		[remove],
	);

	if (widgetsLoading && widgets.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	const canEdit = true; // server enforces admin on mutations; UI surface always shows, mutations may 401

	const filters = {
		timeRange: timeRange.label,
		service: service || null,
		project: project || null,
	};

	return (
		<div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
			<FilterBar
				timeRange={timeRange.label}
				onTimeRange={setTimeRangeLabel}
				service={service || null}
				onService={(v) => setService(v ?? "")}
				project={project || null}
				onProject={(v) => setProject(v ?? "")}
				refreshMs={refreshMs}
				onRefreshMs={(v) => setRefreshMsStr(String(v))}
				loading={widgetsLoading}
				onManualRefresh={() => {
					refetch();
					setRefreshKey((k) => k + 1);
				}}
				editMode={editMode}
				onEditMode={setEditMode}
				onAddWidget={() => setEditor({ open: true })}
				canEdit={canEdit}
				status={health ? { ok: health.ok, uptime: health.uptime } : null}
			/>

			{hidden.size > 0 && (
				<div className="text-xs text-muted-foreground">
					{hidden.size} hidden ·{" "}
					<button
						type="button"
						onClick={() => {
							setHidden(new Set());
							writeHidden(new Set());
						}}
						className="underline"
					>
						show all
					</button>
				</div>
			)}

			<div ref={gridContainerRef} className="flex-1 overflow-auto">
				<WidgetGrid
					widgets={visibleWidgets}
					editMode={editMode}
					width={gridWidth}
					onLayoutChange={handleLayoutChange}
					renderWidget={(w) => (
						<WidgetTile
							widget={w}
							filters={filters}
							refreshKey={refreshKey}
							editMode={editMode}
							onEdit={() => setEditor({ open: true, widget: w })}
							onDuplicate={() => handleDuplicate(w)}
							onDelete={() => handleDelete(w)}
							onHide={() => toggleHidden(w.id)}
						/>
					)}
				/>
			</div>

			{editor.open && (
				<WidgetEditor
					initial={editor.widget}
					filterFrom={filterFrom}
					filterTo={filterTo}
					service={service || null}
					project={project || null}
					onCancel={() => setEditor({ open: false })}
					onSave={async (w) => {
						if (editor.widget?.id && w.id === editor.widget.id) {
							await update(w.id, w);
						} else {
							await create(w);
						}
						setEditor({ open: false });
					}}
				/>
			)}
		</div>
	);
}

function WidgetTile({
	widget,
	filters,
	refreshKey,
	editMode,
	onEdit,
	onDuplicate,
	onDelete,
	onHide,
}: {
	widget: Widget;
	filters: { timeRange: string; service: string | null; project: string | null };
	refreshKey: number;
	editMode: boolean;
	onEdit: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onHide: () => void;
}) {
	const data = useWidgetData(widget, filters, refreshKey);
	return (
		<div className="group relative flex h-full flex-col">
			<div className="widget-no-drag flex items-center justify-between border-b border-border/40 px-3 py-1.5">
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-xs font-medium">{widget.name}</span>
					{widget.description && (
						<span className="truncate text-[10px] text-muted-foreground">{widget.description}</span>
					)}
				</div>
				{editMode && (
					<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
						{!widget.builtin && (
							<button
								type="button"
								onClick={onEdit}
								title="Edit"
								className="rounded p-1 hover:bg-muted"
							>
								<Pencil className="h-3 w-3" />
							</button>
						)}
						<button
							type="button"
							onClick={onDuplicate}
							title="Duplicate"
							className="rounded p-1 hover:bg-muted"
						>
							<Copy className="h-3 w-3" />
						</button>
						{widget.builtin ? (
							<button
								type="button"
								onClick={onHide}
								title="Hide"
								className="rounded p-1 hover:bg-muted"
							>
								<EyeOff className="h-3 w-3" />
							</button>
						) : (
							<button
								type="button"
								onClick={onDelete}
								title="Delete"
								className="rounded p-1 text-destructive hover:bg-destructive/10"
							>
								<Trash2 className="h-3 w-3" />
							</button>
						)}
					</div>
				)}
			</div>
			<div className="flex-1 overflow-hidden">
				<WidgetRenderer
					widget={widget}
					rows={data.rows}
					columns={data.columns}
					loading={data.loading}
					error={data.error}
					onReload={data.reload}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 17.2: Typecheck**

Run: `cd app && tsc --noEmit -p tsconfig.app.json`
Expected: PASS.

- [ ] **Step 17.3: Lint + format**

Run (from repo root):

```bash
bun run lint
bun run format
```

Expected: no new warnings introduced in the files just created/modified.

- [ ] **Step 17.4: Commit**

```bash
git add app/src/views/dashboard.tsx
git commit -m "feat(app): rewrite dashboard view as widget-grid orchestrator"
```

---

## Task 18 — Live smoke test

- [ ] **Step 18.1: Start dev stack**

Run (from repo root):

```bash
bun run dev
```

Expected: server on :3485 and app on :5173, seeded logs streaming in.

- [ ] **Step 18.2: Open dashboard**

Browse to `http://localhost:5173/#dashboard` (or click the Dashboard nav).

Verify, in order:

1. All 12 builtin widgets render without error.
2. Stat tiles (Total Logs, Database Size, Error Rate) show numbers formatted correctly (numbers, bytes, percent).
3. "Log Volume" and "Errors Over Time" line charts show per-minute buckets.
4. Latency Percentiles line chart renders p50/p95/p99 (only if wide events with `duration_ms` exist in seed data).
5. Service Health grid shows colored dots per service.
6. Top Error Messages + Slowest Wide Events + Recent Errors tables render rows.
7. Changing the time range (1h → 7d) refetches all widgets.
8. Changing the service dropdown scopes the dashboard; tiles that reference `${service}` re-filter.
9. Toggle edit mode on → tiles become draggable. Drag one tile; after 2s, the PUT fires (check Network tab: `PUT /widgets/<id>`).
10. Click "Add widget" → editor modal opens with CodeMirror editor. Type a SELECT with `${from}`/`${to}`; preview renders after 500ms.
11. Save new widget → appears on grid.
12. Click Duplicate on a builtin → editor opens with cloned fields (empty id); save creates a new non-builtin.
13. Click Hide on a builtin → tile disappears; "N hidden · show all" link appears at top; clicking it restores.
14. Hard refresh → all state (time range, service, project, layout positions) restored from URL hash + server.

If any step fails, fix the specific widget/hook and commit the fix as `fix(app): <what>`.

- [ ] **Step 18.3: Stop dev stack**

Ctrl+C the `bun run dev` process.

- [ ] **Step 18.4: Run all tests**

Run (from repo root):

```bash
bun run test:all
```

Expected: all server + client tests pass.

---

## Notes for the Implementer

- **Don't delete existing files you didn't touch**: `stat-card.tsx`, `timeline-strip.tsx`, `level-chart.tsx` stay — other views still use them.
- **Path alias**: the app uses `@/…` for `src/…`; keep that convention.
- **Tests use two runners**: `bun test` for server (`test/*.test.ts`), `vitest` for client (`*.vitest.{ts,tsx}` via `cd app && bun run test`). Don't mix them.
- **Health endpoint survival**: `useHealth` still drives the tiny "online · uptime" badge in the filter bar. Don't remove `app/src/hooks/use-health.ts`.
- **CSS**: `react-grid-layout/css/styles.css` and `react-resizable/css/styles.css` are imported directly by the grid component — no extra global wiring needed.
- **`key_prefix` column**: ignore; the role-based auth in `src/server/middleware/auth.ts` applies per-widget route but per-widget data still goes through `/query` which is `read`-gated.
- **Existing dashboard props**: old `DashboardView` took an `onZoom` prop from timeline drill-through; it's removed in the rewrite. If the caller in `App.tsx` passes it, drop that prop at the call site (one line).

---

## Self-Review Coverage Map

| Spec section                                                        | Task(s)                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| Data Model → Widget type                                            | Task 1                                                    |
| Data Model → Persistence (`widgets.json`)                           | Task 3                                                    |
| Data Model → API (`/widgets` GET/POST/PUT/DELETE, auth)             | Tasks 5, 6                                                |
| Rendering Pipeline → load + per-widget query                        | Tasks 7, 9                                                |
| Rendering Pipeline → `substituteVars`                               | Task 8                                                    |
| Rendering Pipeline → dispatcher + error states                      | Tasks 10, 12                                              |
| OOTB seeds (12 widgets)                                             | Task 4                                                    |
| Percentile query (SQLite row-number approach)                       | Task 4 (latency widget SQL)                               |
| Health stats as plain SQL + filter-bar chrome                       | Task 4 (`total-logs`, `db-size`) + Task 15 (status badge) |
| Filter bar (time, service, project, auto-refresh, edit toggle, add) | Task 15                                                   |
| Edit mode + drag/resize + debounced PUT (2s)                        | Task 14                                                   |
| Add/edit modal w/ CodeMirror + live preview (500ms debounce)        | Task 16                                                   |
| Duplicate / Hide / Delete                                           | Task 17                                                   |
| First-run (seeded default `widgets.json`)                           | Tasks 3, 4                                                |
| File structure / renderers                                          | Tasks 10–12                                               |
| Testing (server CRUD, auth, substituteVars, renderer)               | Tasks 3, 5, 8, 12                                         |
| Query timeout (15s)                                                 | Task 9                                                    |
| Concrete values (2s / 15s / 500ms / 60s dropdown cache)             | Tasks 9, 14, 15, 16                                       |

All spec sections mapped. No TBDs or placeholders in step bodies.
