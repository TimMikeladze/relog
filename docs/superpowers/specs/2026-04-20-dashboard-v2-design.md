# Dashboard v2 — Design Spec

**Date**: 2026-04-20
**Status**: Approved for implementation planning
**Sub-project**: 1 of 3 (Dashboard v2 → Custom SQL widgets → Alerting)

## Summary

Replace the current hardcoded dashboard (`app/src/views/dashboard.tsx`) with a widget-grid system. Every tile is a generic widget defined by `{kind, sql, options, layout}`. The out-of-the-box dashboard ships as seeded "builtin" widgets; the same data model powers user-authored SQL widgets (sub-project 2) and alert rules (sub-project 3).

## Goals

- Richer OOTB developer metrics: error rate, latency percentiles, throughput per service, top error messages, slowest wide events, service health grid, project×branch breakdown, plus existing stats (total logs, DB size, log volume, recent errors).
- Unified widget abstraction so custom SQL widgets reuse the same renderer path, with no divergence between OOTB and user widgets.
- Server-side persistence of widget definitions and layout so the dashboard survives browser/device changes.
- Global filter bar (time range, service, project) with per-widget time-range override.

## Non-Goals

- Multiple named dashboards (single dashboard only)
- Drill-through on widget click (deferred)
- Mobile-optimized layout (desktop-first)
- Sharing / import / export widget JSON (deferred)
- Alerting (sub-project 3, separate spec)
- User SQL widgets (sub-project 2, separate spec) — this spec only establishes the generic renderer + data model they will plug into

## Data Model

### Widget

```ts
type WidgetKind =
	| "stat"
	| "line"
	| "bar"
	| "table"
	| "status-grid"
	| "heatmap"
	| "gauge"
	| "sparkline";

type Widget = {
	id: string; // slug, regex /^[a-zA-Z0-9_-]{1,128}$/
	name: string;
	description?: string;
	kind: WidgetKind;
	sql: string; // may reference ${from}, ${to}, ${service}, ${project}
	options: WidgetOptions; // kind-specific (see below)
	layout: { x: number; y: number; w: number; h: number }; // react-grid-layout units
	timeRange?: string; // optional override, e.g. "1h" | "24h" | "7d"
	createdAt: number;
	updatedAt: number;
	builtin?: boolean; // true for OOTB seeds; user edits clone to a non-builtin copy
};

type WidgetOptions =
	| StatOptions
	| LineOptions
	| BarOptions
	| TableOptions
	| StatusGridOptions
	| HeatmapOptions
	| GaugeOptions
	| SparklineOptions;

type StatOptions = {
	valueField: string;
	deltaField?: string;
	format?: "number" | "bytes" | "ms" | "percent";
};
type LineOptions = { xField: string; yFields: string[]; yFormat?: "number" | "ms" | "percent" };
type BarOptions = {
	categoryField: string;
	valueField: string;
	orientation?: "horizontal" | "vertical";
};
type TableOptions = {
	columns: { field: string; label?: string; format?: "number" | "bytes" | "ms" | "timestamp" }[];
};
type StatusGridOptions = {
	labelField: string;
	statusField: string;
	thresholds: { healthy: number; degraded: number };
};
type HeatmapOptions = { xField: string; yField: string; valueField: string };
type GaugeOptions = {
	valueField: string;
	min?: number;
	max: number;
	thresholds?: { warn: number; crit: number };
};
type SparklineOptions = { xField: string; yField: string };
```

### Persistence

- File: `~/.relog/widgets.json` (location via new `getWidgetsPath()` in `src/paths.ts`, mirroring aggregates).
- Versioned: top-level `{ version: 1, widgets: Widget[] }`. Future schema changes add a migration step on load.
- On first load, seed `DEFAULT_WIDGETS` (below) and persist. User edits, hides, and additions merge by id.
- Hidden builtin ids and UI state (edit mode, auto-refresh) live in `localStorage` — per-device, not persisted server-side.

### API

`src/server/routes/widgets.ts`, mirroring `routes/aggregates.ts`:

| Method | Path           | Auth  | Body                                   | Returns                  |
| ------ | -------------- | ----- | -------------------------------------- | ------------------------ |
| GET    | `/widgets`     | read  | –                                      | `{ widgets: Widget[] }`  |
| GET    | `/widgets/:id` | read  | –                                      | `{ widget: Widget }`     |
| POST   | `/widgets`     | admin | `Omit<Widget, createdAt\|updatedAt>`   | `{ widget: Widget }` 201 |
| PUT    | `/widgets/:id` | admin | `Partial<Omit<Widget, id\|createdAt>>` | `{ widget: Widget }`     |
| DELETE | `/widgets/:id` | admin | –                                      | 204                      |

Id validation: `^[a-zA-Z0-9_-]{1,128}$`. Deleting a builtin id is rejected (hide via localStorage instead).

## Rendering Pipeline

1. Dashboard loads `/widgets` → cached in `useWidgets` hook.
2. Filter bar provides `{ from, to, service, project }` via `useHashParam` (URL-synced so reload preserves state).
3. Each widget's own hook `useWidgetData(widget, filters)`:
   - Resolves per-widget `timeRange` override to `{from, to}` if set, else uses bar values.
   - Calls `substituteVars(widget.sql, resolvedVars)`.
   - POSTs `/query` with resolved SQL.
   - Returns `{rows, columns, loading, error}`.
4. `<WidgetRenderer kind={w.kind} rows={rows} options={w.options} />` dispatches to kind-specific component.
5. Refresh: global auto-refresh interval triggers a refetch per widget (re-runs each widget's query with its current filter snapshot).

### SQL Variable Substitution

`app/src/components/dashboard/sql-vars.ts`:

```ts
substituteVars(sql: string, vars: { from: number; to: number; service?: string; project?: string }): string
```

Rules:

- `${from}` / `${to}` → epoch-ms integer literals.
- `${service}` / `${project}` → quoted SQLite string literal (`'my-service'`) if set; literal `NULL` if unset. Single-quote escaping (`'` → `''`).
- Unknown `${...}` reference → throw; widget surfaces error badge.
- Only the listed placeholders are recognized; any other `$` in SQL is untouched.
- The server `/query` endpoint already restricts to `SELECT`/`EXPLAIN`/`PRAGMA` — substitution does not weaken that boundary.

### Widget Renderer Dispatch

`app/src/components/dashboard/widget-renderer.tsx`:

```tsx
switch (kind) {
	case "stat":
		return <StatWidget rows options />;
	case "line":
		return <LineWidget rows options />;
	case "bar":
		return <BarWidget rows options />;
	case "table":
		return <TableWidget rows options />;
	case "status-grid":
		return <StatusGridWidget rows options />;
	case "heatmap":
		return <HeatmapWidget rows options />;
	case "gauge":
		return <GaugeWidget rows options />;
	case "sparkline":
		return <SparklineWidget rows options />;
}
```

Each renderer validates required option fields against returned columns; missing field → renders `<WidgetError message="option X references missing column Y" />`.

### Error States (per widget, do not block dashboard)

- Loading: inline spinner
- SQL error: red badge + error message from server
- Query timeout (>15s client-side): "query timed out" + retry button
- Empty rows: muted "No data"
- Missing required option field: error badge naming the missing column

## OOTB Widget Seeds

Seeded in `DEFAULT_WIDGETS` with `builtin: true`. SQL sketches — final SQL validated during implementation.

| #   | id                    | Name                   | Kind        | Metric                                                                                |
| --- | --------------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------- |
| 1   | `total-logs`          | Total Logs             | stat        | count in range                                                                        |
| 2   | `db-size`             | Database Size          | stat        | `SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()` |
| 3   | `error-rate`          | Error Rate             | stat        | a — `SUM(CASE WHEN level IN ('error','fatal') THEN 1 END) * 100.0 / COUNT(*)`         |
| 4   | `errors-over-time`    | Errors Over Time       | line        | a — per-minute count of error+fatal                                                   |
| 5   | `throughput`          | Throughput per Service | line        | c — logs/sec per service, bucketed                                                    |
| 6   | `latency-p50-p95-p99` | Latency Percentiles    | line        | b — `json_extract(meta, '$.duration_ms')` percentiles per bucket                      |
| 7   | `top-errors`          | Top Error Messages     | table       | d — `GROUP BY message` with `COUNT(*)`, `MAX(timestamp) AS last_seen`                 |
| 8   | `slowest-events`      | Slowest Wide Events    | table       | e — `WHERE json_extract(meta,'$.event') = 1 ORDER BY duration_ms DESC LIMIT 20`       |
| 9   | `service-health`      | Service Health         | status-grid | h — per-service last-5min error% mapped to healthy/degraded/error by thresholds       |
| 10  | `project-branch`      | Project × Branch       | bar         | j — `GROUP BY project, branch COUNT(*)`                                               |
| 11  | `log-volume`          | Log Volume             | line        | existing — bucket `created_at`                                                        |
| 12  | `recent-errors`       | Recent Errors          | table       | existing — last 10 logs where `level IN ('error','fatal')`                            |

**Health stats via plain SQL (no special-casing)**: the current dashboard's `/health` endpoint returns status, log count, DB size, and uptime. Rather than special-case a "health" widget that bypasses the SQL pipeline, each of those becomes its own plain-SQL tile:

- `total-logs` → `SELECT COUNT(*) FROM logs WHERE created_at BETWEEN ${from} AND ${to}`
- `db-size` → `SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()` (pragma queries are already allowed by `/query`)
- Uptime and status are dashboard-chrome, not widgets: surface them inline in the top filter bar (small "online · uptime 3d" badge next to auto-refresh). Keeps the widget pipeline uniform and avoids a virtual table-valued function.

### Default Layout

3-column grid (react-grid-layout `cols=12`, each widget w=4 default):

- Row 1 (stats, h=2): `total-logs`, `db-size`, `error-rate`
- Row 2 (lines, h=4): `log-volume` (w=12)
- Row 3 (lines, h=4): `errors-over-time` (w=6), `throughput` (w=6)
- Row 4 (lines, h=4): `latency-p50-p95-p99` (w=12)
- Row 5 (grid, h=3): `service-health` (w=12)
- Row 6 (bars, h=4): `project-branch` (w=6), `top-errors` (w=6)
- Row 7 (tables, h=5): `slowest-events` (w=6), `recent-errors` (w=6)

### SQLite Percentile Approach

Vanilla SQLite has no `PERCENTILE_CONT`. For widget #6 (latency percentiles), compute in SQL using window functions + row indexing per time bucket:

```sql
WITH durations AS (
  SELECT
    CAST(created_at / 60000 AS INTEGER) * 60000 AS bucket,
    CAST(json_extract(meta, '$.duration_ms') AS REAL) AS d
  FROM logs
  WHERE created_at BETWEEN ${from} AND ${to}
    AND json_extract(meta, '$.duration_ms') IS NOT NULL
),
ranked AS (
  SELECT bucket, d,
         ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY d) AS rn,
         COUNT(*)    OVER (PARTITION BY bucket) AS n
  FROM durations
)
SELECT bucket,
       MAX(CASE WHEN rn = CAST(n * 0.50 AS INTEGER) + 1 THEN d END) AS p50,
       MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN d END) AS p95,
       MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN d END) AS p99
FROM ranked
GROUP BY bucket
ORDER BY bucket;
```

Acceptable perf for typical log volumes (< ~1M rows in window). If benchmarks show regression at scale, revisit with a custom SQLite function registered at boot.

## UX Flows

### Top Filter Bar

Replaces the current dashboard header. Left-to-right:

- Time range toggle: 1h / 6h / 24h / 7d / 30d (existing control, reused)
- Service picker: **single-select** dropdown (explicit scope choice — multi-select deferred to a later spec). Options from `SELECT DISTINCT service FROM logs WHERE service IS NOT NULL ORDER BY service`, cached 60s. Unselected → `${service}` substitutes to `NULL`.
- Project picker: single-select on `project` column, same treatment
- Spacer
- Auto-refresh dropdown (Off / 10s / 30s / 60s — existing)
- Manual refresh button (existing)
- Edit-mode toggle (admin role only): unlocks drag/resize and reveals per-widget edit/duplicate/delete overlays, plus an "Add widget" button

All bar state (time, service, project, refresh) is URL-synced via `useHashParam` so reloads and shared links preserve view.

### Edit Mode

- Toggle off (default): react-grid-layout `isDraggable={false} isResizable={false}`. No per-widget controls.
- Toggle on: drag+resize enabled. Each widget grows a hover overlay with icons: edit, duplicate, delete/hide.
- Layout changes locally updated immediately; batched PUT to `/widgets/:id` on 2s debounce or on edit-mode exit. Retry once on failure; surface toast on repeated failure.

### Add / Edit Modal

Shared component `WidgetEditor`:

- Left pane — form:
  - Name, description
  - Kind dropdown (8 options)
  - CodeMirror SQL editor reusing keymap, theme, autocomplete wiring from `app/src/views/query.tsx`
  - Time-range override selector (inherit / 1h / 6h / 24h / 7d / 30d)
  - Options panel — dynamic per kind:
    - Shows column names from the last successful preview run
    - e.g. for `stat`: value-field select, delta-field select, format dropdown
    - e.g. for `status-grid`: label-field select, status-field select, healthy/degraded thresholds
- Right pane — live preview:
  - Runs the current SQL against current filter bar (debounced 500ms)
  - Renders preview via the same `WidgetRenderer`
  - Shows column list for option field picking
- Footer: Save / Cancel. Save validates required option fields; invalid → inline error.

### Duplicate / Delete / Hide

- Duplicate (any widget): opens modal with a copy, `id = <orig>-copy-N`, `builtin: false`.
- Delete (non-builtin only): confirm dialog, then DELETE `/widgets/:id`.
- Hide (builtin only): adds id to `localStorage["relog:hidden-widgets"]`. No server call. Re-show via a "Show hidden (N)" link that appears when any are hidden.

### First-Run

Empty `widgets.json` → server seeds and persists defaults on first boot. Client sees full default dashboard. No onboarding modal.

## File Structure

### Server

- `src/server/widgets.ts` — `WidgetsManager` class (init, getAll, get, add, update, remove, persist). Mirrors `aggregates.ts`. Holds `DEFAULT_WIDGETS`.
- `src/server/routes/widgets.ts` — request handler (mirrors `routes/aggregates.ts`).
- `src/server/server.ts` — instantiate manager on boot, mount route, wire auth (read/admin pattern, same switch as aggregates).
- `src/paths.ts` — add `getWidgetsPath()`.
- `src/types.ts` — export `Widget`, `WidgetKind`, `WidgetOptions` unions.

### Client

- `app/src/views/dashboard.tsx` — rewritten as orchestration shell: filter bar + widget grid.
- `app/src/components/dashboard/filter-bar.tsx`
- `app/src/components/dashboard/widget-grid.tsx` — wraps react-grid-layout, handles layout persistence.
- `app/src/components/dashboard/widget-renderer.tsx` — kind dispatcher.
- `app/src/components/dashboard/widgets/stat.tsx`
- `app/src/components/dashboard/widgets/line.tsx`
- `app/src/components/dashboard/widgets/bar.tsx`
- `app/src/components/dashboard/widgets/table.tsx`
- `app/src/components/dashboard/widgets/status-grid.tsx`
- `app/src/components/dashboard/widgets/heatmap.tsx`
- `app/src/components/dashboard/widgets/gauge.tsx`
- `app/src/components/dashboard/widgets/sparkline.tsx`
- `app/src/components/dashboard/widget-editor.tsx` — modal with CodeMirror + live preview.
- `app/src/components/dashboard/sql-vars.ts` — `substituteVars` + tests.
- `app/src/hooks/use-widgets.ts` — CRUD + local cache.
- `app/src/hooks/use-widget-data.ts` — per-widget query execution + refresh.
- `app/src/api/client.ts` — add `/widgets` helper functions.

### Dependencies

- `react-grid-layout` + its CSS (`react-grid-layout/css/styles.css`, `react-resizable/css/styles.css`)

### Removed / Refactored

- Current `app/src/views/dashboard.tsx` monolith split into the files above.
- `StatCard` (`app/src/components/stat-card.tsx`) reused inside `stat` widget renderer.
- `TimelineStrip` (`app/src/components/timeline-strip.tsx`) reused inside `line` widget renderer for the `log-volume` case; long-term it may become a generic line renderer.

## Testing

- **Server `widgets.test.ts`**: CRUD happy path, auth role gating (read cannot POST/PUT/DELETE), id validation regex, default seeding on empty file, persistence round-trip, delete-builtin rejection.
- **Client `sql-vars.vitest.ts`**: all vars substituted, unknown var throws, missing var substitutes NULL, single-quote escaping, arbitrary `$` passthrough, injection attempts (`'; DROP TABLE logs; --`) produce syntactically quoted strings (server read-only guard is the ultimate defense; this test confirms we do not help an attacker by accidentally unquoting).
- **Client `widget-renderer.vitest.tsx`**: each kind renders expected shape from fixture rows; empty rows → empty state; missing required option field → error badge.
- **Client `widget-editor.vitest.tsx`**: live preview debounces on SQL change, save emits expected payload, option validation blocks save.
- **Client `widget-grid.vitest.tsx`**: layout mutation triggers debounced PUT (mock), admin gate hides edit UI for read role.

## Edge Cases

- **Bad user SQL**: widget shows red badge; dashboard keeps rendering others.
- **Slow query**: per-widget loading; 15s client-side timeout; shows "query timed out" with retry.
- **Unset filter var**: referenced `${service}` substitutes `NULL`; filters like `service = NULL` always false → empty state. Widget authors work around with `WHERE (${service} IS NULL OR service = ${service})`. First-class optional marker deferred to sub-project 2.
- **Percentile query on large windows**: bucket floor and row-number approach limits cost; if regressions observed in practice, revisit with a registered SQLite C function.
- **relog upgrade adds new builtin id**: appears on next boot (merged into existing `widgets.json`). If user had hidden it in a previous version, it stays hidden (hidden list is indexed by id, not payload hash).
- **Concurrent edits**: last-write-wins. Single-admin case dominates; real multi-admin conflict resolution is out of scope.
- **Schema migration**: `widgets.json` has top-level `version`. On load, if `version < current`, run migration step before use.

## Rollout

- One PR for server (widgets manager, route, default seeds, tests).
- One PR for client (rewrite dashboard view, grid, renderers, editor, tests).
- Feature-gate behind no flag — ship directly; the replacement is strictly additive on the API (new endpoint, no removals) and the UI swap is atomic.

## Concrete Values

- Client-side query timeout: **15s** per widget
- Layout-PUT debounce: **2s** after last drag/resize, plus immediate flush on edit-mode exit
- Preview-run debounce in editor: **500ms** after last SQL change
- Service/project dropdown options cache: **60s**
