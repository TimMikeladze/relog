# App UI/UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the relog.dev web UI to expose every framework capability with power-user features: traces view, query workbench, command palette, keyboard shortcuts, timeline scrubber, export, and enhanced dashboard.

**Architecture:** Panel-based single-window layout. Five views (Live, Explore, Traces, Query, Dashboard) accessed via tab navigation + hash routing. Status bar at bottom. Command palette (Cmd+K) + vim-style keyboard shortcuts. Timeline strip component shared across Live/Explore/Traces. Right-side slide panel for log detail. Recharts for all charts. CodeMirror for SQL editor. localStorage for saved queries/history/preferences.

**Tech Stack:** React 19, Vite 7, Tailwind 4, shadcn/ui, Recharts (latest), CodeMirror 6, lucide-react. Package manager: bun.

---

## Phase 1: Foundation

### Task 1: Install dependencies

**Files:**

- Modify: `app/package.json`

**Step 1: Install recharts and codemirror**

```bash
cd app && bun add recharts @codemirror/lang-sql @codemirror/view @codemirror/state codemirror @codemirror/theme-one-dark
```

**Step 2: Verify install**

```bash
cd app && bun run build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add app/package.json app/bun.lock
git commit -m "feat(app): add recharts and codemirror dependencies"
```

---

### Task 2: Update types and hash state for new views

**Files:**

- Modify: `app/src/types.ts`
- Modify: `app/src/hooks/use-hash-state.ts`

**Step 1: Update View type to include new views**

In `app/src/types.ts`, change the View type:

```typescript
export type View = "live" | "explore" | "traces" | "query" | "dashboard";
```

**Step 2: Update hash state to support trace_id filter**

In `app/src/types.ts`, add `trace_id` to Filters:

```typescript
export interface Filters {
	level?: string;
	service?: string;
	project?: string;
	branch?: string;
	version?: string;
	deployment_id?: string;
	grep?: string;
	from?: string;
	to?: string;
	trace_id?: string;
}
```

**Step 3: Update parseHash in use-hash-state.ts**

Add the trace_id filter parsing:

```typescript
if (params.get("trace_id")) filters.trace_id = params.get("trace_id")!;
```

**Step 4: Verify build**

```bash
cd app && bun run build
```

Expected: Build succeeds (will have type errors in App.tsx for new views — that's fine, we fix next).

**Step 5: Commit**

```bash
git add app/src/types.ts app/src/hooks/use-hash-state.ts
git commit -m "feat(app): add traces and query views to types, add trace_id filter"
```

---

## Phase 2: Layout Shell

### Task 3: Create status bar component

**Files:**

- Create: `app/src/components/layout/status-bar.tsx`

**Step 1: Create status bar**

```tsx
import { useHealth } from "@/hooks/use-health";
import { Circle } from "lucide-react";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function StatusBar() {
	const { data: health } = useHealth(true, 15_000);

	return (
		<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1 text-[10px] text-muted-foreground font-mono">
			<div className="flex items-center gap-1.5">
				<Circle
					className={`h-1.5 w-1.5 ${health?.ok ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
				/>
				<span>{health?.ok ? "Connected" : "Disconnected"}</span>
			</div>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `${health.log_count.toLocaleString()} logs` : "—"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `db: ${formatBytes(health.db_size_bytes)}` : "—"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `up ${formatUptime(health.uptime)}` : "—"}</span>
		</div>
	);
}
```

**Step 2: Commit**

```bash
git add app/src/components/layout/status-bar.tsx
git commit -m "feat(app): add status bar component"
```

---

### Task 4: Update header with new tabs and Cmd+K button

**Files:**

- Modify: `app/src/components/layout/header.tsx`

**Step 1: Update views array and add Cmd+K affordance**

Replace the views array:

```typescript
const views: { id: View; label: string; shortcut: string }[] = [
	{ id: "live", label: "Live", shortcut: "g l" },
	{ id: "explore", label: "Explore", shortcut: "g e" },
	{ id: "traces", label: "Traces", shortcut: "g t" },
	{ id: "query", label: "Query", shortcut: "g q" },
	{ id: "dashboard", label: "Dashboard", shortcut: "g d" },
];
```

Add `onCommandPalette` to the Header props and render a Cmd+K button between the theme toggle and settings:

```tsx
<button
	type="button"
	onClick={onCommandPalette}
	className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
>
	<Command className="h-3 w-3" />
	<span>K</span>
</button>
```

Import `Command` from lucide-react. Add `onCommandPalette: () => void` to props.

**Step 2: Verify build**

```bash
cd app && bun run build
```

Expected: Type errors in App.tsx where Header is used (missing onCommandPalette prop). That's expected — we wire it up in Task 7.

**Step 3: Commit**

```bash
git add app/src/components/layout/header.tsx
git commit -m "feat(app): add traces/query tabs and cmd+k button to header"
```

---

### Task 5: Create placeholder views for Traces and Query

**Files:**

- Create: `app/src/views/traces.tsx`
- Create: `app/src/views/query.tsx`

**Step 1: Create placeholder traces view**

```tsx
import type { Filters } from "@/types";

export function TracesView({ filters, enabled }: { filters: Filters; enabled: boolean }) {
	return (
		<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			Traces view — coming soon
		</div>
	);
}
```

**Step 2: Create placeholder query view**

```tsx
export function QueryView({ enabled }: { enabled: boolean }) {
	return (
		<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
			Query workbench — coming soon
		</div>
	);
}
```

**Step 3: Commit**

```bash
git add app/src/views/traces.tsx app/src/views/query.tsx
git commit -m "feat(app): add placeholder traces and query views"
```

---

### Task 6: Create keyboard hooks

**Files:**

- Create: `app/src/hooks/use-keyboard.ts`

**Step 1: Create the keyboard hook**

This hook handles:

- Single-key shortcuts (/, Escape, Space, j, k, c, t, x, ?)
- Chord shortcuts (g+l, g+e, g+t, g+q, g+d)
- Cmd+K for command palette
- Cmd+Enter for query execution

```tsx
import { useCallback, useEffect, useRef } from "react";

type KeyHandler = () => void;

interface KeyMap {
	[key: string]: KeyHandler;
}

export function useKeyboard(keyMap: KeyMap) {
	const pendingRef = useRef<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const handler = useCallback(
		(e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const isInput =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable ||
				target.closest(".cm-editor");

			// Meta/Ctrl combos always fire
			if (e.metaKey || e.ctrlKey) {
				const combo = `${e.metaKey ? "cmd" : "ctrl"}+${e.key.toLowerCase()}`;
				if (keyMap[combo]) {
					e.preventDefault();
					keyMap[combo]();
					return;
				}
				// cmd+shift combos
				if (e.shiftKey) {
					const shiftCombo = `${e.metaKey ? "cmd" : "ctrl"}+shift+${e.key.toLowerCase()}`;
					if (keyMap[shiftCombo]) {
						e.preventDefault();
						keyMap[shiftCombo]();
						return;
					}
				}
				return;
			}

			// Don't process single keys when in an input
			if (isInput) {
				if (e.key === "Escape" && keyMap["Escape"]) {
					e.preventDefault();
					keyMap["Escape"]();
				}
				return;
			}

			// Chord handling (g + second key)
			if (pendingRef.current === "g") {
				clearTimeout(timerRef.current);
				pendingRef.current = null;
				const chord = `g ${e.key.toLowerCase()}`;
				if (keyMap[chord]) {
					e.preventDefault();
					keyMap[chord]();
					return;
				}
			}

			if (e.key === "g") {
				pendingRef.current = "g";
				timerRef.current = setTimeout(() => {
					pendingRef.current = null;
				}, 500);
				return;
			}

			const key = e.key === " " ? "Space" : e.key;
			if (keyMap[key]) {
				e.preventDefault();
				keyMap[key]();
			}
		},
		[keyMap],
	);

	useEffect(() => {
		window.addEventListener("keydown", handler);
		return () => {
			window.removeEventListener("keydown", handler);
			clearTimeout(timerRef.current);
		};
	}, [handler]);
}
```

**Step 2: Commit**

```bash
git add app/src/hooks/use-keyboard.ts
git commit -m "feat(app): add keyboard shortcut hook with chord support"
```

---

### Task 7: Wire up App.tsx with new layout

**Files:**

- Modify: `app/src/App.tsx`

**Step 1: Update App.tsx**

Add imports for new views, status bar, keyboard hook, and command palette state. Wire up the full layout:

```tsx
import { useMemo, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useHashState } from "@/hooks/use-hash-state";
import { useKeyboard } from "@/hooks/use-keyboard";
import { Header } from "@/components/layout/header";
import { FilterBar } from "@/components/layout/filter-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { AuthDialog } from "@/components/auth-dialog";
import { LiveView } from "@/views/live";
import { ExploreView } from "@/views/explore";
import { TracesView } from "@/views/traces";
import { QueryView } from "@/views/query";
import { DashboardView } from "@/views/dashboard";
import { Loader2 } from "lucide-react";
import type { View } from "@/types";

function AppContent() {
	const auth = useAuth();
	const { view, filters, page, setView, setFilters, updateFilter, setPage } = useHashState();
	const [showSettings, setShowSettings] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);

	const keyMap = useMemo(
		() => ({
			"cmd+k": () => setShowCommandPalette((v) => !v),
			Escape: () => {
				setShowCommandPalette(false);
				setShowSettings(false);
			},
			"g l": () => setView("live" as View),
			"g e": () => setView("explore" as View),
			"g t": () => setView("traces" as View),
			"g q": () => setView("query" as View),
			"g d": () => setView("dashboard" as View),
			"?": () => {}, // TODO: show shortcuts cheatsheet
		}),
		[setView],
	);

	useKeyboard(keyMap);

	if (auth.status === "checking") {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					<span className="text-xs text-muted-foreground">Connecting to relog.dev...</span>
				</div>
			</div>
		);
	}

	if (auth.status === "needs-auth") {
		return (
			<div className="h-screen bg-background">
				<AuthDialog onClose={() => {}} />
			</div>
		);
	}

	if (auth.status === "error") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
				<span className="text-sm text-destructive">{auth.error}</span>
				<button
					type="button"
					onClick={() => setShowSettings(true)}
					className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
				>
					Change Server URL
				</button>
				{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
			</div>
		);
	}

	const showFilterBar = view !== "dashboard" && view !== "query";

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<Header
				currentView={view}
				onViewChange={setView}
				onSettingsClick={() => setShowSettings(true)}
				onCommandPalette={() => setShowCommandPalette(true)}
			/>
			{showFilterBar && (
				<FilterBar
					filters={filters}
					view={view}
					onUpdateFilter={updateFilter}
					onClearFilters={() => setFilters({})}
				/>
			)}
			<div className="flex flex-1 overflow-hidden">
				{view === "live" && <LiveView filters={filters} enabled={view === "live"} />}
				{view === "explore" && (
					<ExploreView
						filters={filters}
						page={page}
						onPageChange={setPage}
						enabled={view === "explore"}
					/>
				)}
				{view === "traces" && <TracesView filters={filters} enabled={view === "traces"} />}
				{view === "query" && <QueryView enabled={view === "query"} />}
				{view === "dashboard" && <DashboardView enabled={view === "dashboard"} />}
			</div>
			<StatusBar />
			{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
		</div>
	);
}

export default function App() {
	return (
		<AuthProvider>
			<AppContent />
		</AuthProvider>
	);
}
```

**Step 2: Verify build**

```bash
cd app && bun run build
```

Expected: Build succeeds. App renders with 5 tabs and status bar.

**Step 3: Commit**

```bash
git add app/src/App.tsx
git commit -m "feat(app): wire up new layout with 5 tabs, status bar, keyboard shortcuts"
```

---

## Phase 3: Timeline Strip

### Task 8: Create useQueryExecute hook (imperative query execution)

The existing `useQuery` hook auto-executes on mount. We need an imperative version for the query workbench and timeline data fetching.

**Files:**

- Create: `app/src/hooks/use-query-execute.ts`

**Step 1: Create the hook**

```tsx
import { useCallback, useState } from "react";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

export function useQueryExecute() {
	const [data, setData] = useState<QueryResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const execute = useCallback(async (sql: string) => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiPost<QueryResult>("/query", { sql });
			setData(res);
			return res;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Query failed";
			setError(msg);
			return null;
		} finally {
			setLoading(false);
		}
	}, []);

	const reset = useCallback(() => {
		setData(null);
		setError(null);
	}, []);

	return { data, loading, error, execute, reset };
}
```

**Step 2: Commit**

```bash
git add app/src/hooks/use-query-execute.ts
git commit -m "feat(app): add imperative query execution hook"
```

---

### Task 9: Create timeline strip component

**Files:**

- Create: `app/src/components/timeline-strip.tsx`

This is a Recharts-based component showing log volume over time with error dot markers. Used in Live, Explore, and Traces views.

**Step 1: Create the component**

```tsx
import { useMemo, useCallback, useEffect, useState } from "react";
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	ResponsiveContainer,
	ReferenceArea,
	Tooltip,
} from "recharts";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

interface TimelineBucket {
	time: number;
	label: string;
	info: number;
	warn: number;
	error: number;
	debug: number;
	trace: number;
	fatal: number;
	total: number;
	hasError: boolean;
}

interface TimelineStripProps {
	from?: string;
	to?: string;
	filters?: Record<string, string | undefined>;
	onBrushChange?: (from: number, to: number) => void;
	refreshKey?: number;
	buckets?: number;
}

const LEVEL_COLORS = {
	fatal: "oklch(0.7 0.19 350)",
	error: "oklch(0.65 0.2 25)",
	warn: "oklch(0.8 0.15 85)",
	info: "oklch(0.7 0.15 160)",
	debug: "oklch(0.65 0.1 250)",
	trace: "oklch(0.6 0.02 0)",
};

function parseRelativeTime(rel: string): number {
	const match = rel.match(/^(\d+)([smhd])$/);
	if (!match) return Date.now() - 3600_000;
	const [, num, unit] = match;
	const ms = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 }[unit] ?? 3600_000;
	return Date.now() - parseInt(num) * ms;
}

function formatTimeLabel(ts: number, rangeMs: number): string {
	const d = new Date(ts);
	if (rangeMs > 86400_000 * 2) {
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	}
	return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

export function TimelineStrip({
	from,
	to,
	filters,
	onBrushChange,
	refreshKey,
	buckets = 60,
}: TimelineStripProps) {
	const [data, setData] = useState<TimelineBucket[]>([]);
	const [brushStart, setBrushStart] = useState<number | null>(null);
	const [brushEnd, setBrushEnd] = useState<number | null>(null);
	const [selecting, setSelecting] = useState(false);

	const timeRange = useMemo(() => {
		const now = Date.now();
		const startMs = from
			? from.match(/^\d+[smhd]$/)
				? parseRelativeTime(from)
				: new Date(from).getTime()
			: now - 3600_000;
		const endMs = to ? new Date(to).getTime() : now;
		return { startMs, endMs, rangeMs: endMs - startMs };
	}, [from, to]);

	useEffect(() => {
		const { startMs, endMs, rangeMs } = timeRange;
		const bucketMs = rangeMs / buckets;

		let whereClause = `WHERE created_at >= ${startMs} AND created_at <= ${endMs}`;
		if (filters?.level) whereClause += ` AND level = '${filters.level}'`;
		if (filters?.service) whereClause += ` AND service = '${filters.service}'`;
		if (filters?.project) whereClause += ` AND project = '${filters.project}'`;
		if (filters?.branch) whereClause += ` AND branch = '${filters.branch}'`;

		const sql = `
      SELECT
        CAST((created_at - ${startMs}) / ${Math.floor(bucketMs)} AS INTEGER) as bucket,
        level,
        COUNT(*) as count
      FROM logs
      ${whereClause}
      GROUP BY bucket, level
      ORDER BY bucket
    `;

		apiPost<QueryResult>("/query", { sql })
			.then((res) => {
				const bucketMap = new Map<number, TimelineBucket>();
				for (let i = 0; i < buckets; i++) {
					const time = startMs + i * bucketMs + bucketMs / 2;
					bucketMap.set(i, {
						time,
						label: formatTimeLabel(time, rangeMs),
						info: 0,
						warn: 0,
						error: 0,
						debug: 0,
						trace: 0,
						fatal: 0,
						total: 0,
						hasError: false,
					});
				}
				for (const row of res.rows) {
					const idx = Number(row.bucket);
					const bucket = bucketMap.get(idx);
					if (!bucket) continue;
					const level = row.level as string;
					const count = Number(row.count);
					if (level in bucket) {
						(bucket as Record<string, unknown>)[level] = count;
					}
					bucket.total += count;
					if (level === "error" || level === "fatal") bucket.hasError = true;
				}
				setData(Array.from(bucketMap.values()));
			})
			.catch(() => {});
	}, [timeRange, filters, refreshKey, buckets]);

	const handleMouseDown = useCallback((e: { activeLabel?: string }) => {
		if (e?.activeLabel) {
			setBrushStart(Number(e.activeLabel));
			setSelecting(true);
		}
	}, []);

	const handleMouseMove = useCallback(
		(e: { activeLabel?: string }) => {
			if (selecting && e?.activeLabel) {
				setBrushEnd(Number(e.activeLabel));
			}
		},
		[selecting],
	);

	const handleMouseUp = useCallback(() => {
		if (selecting && brushStart !== null && brushEnd !== null && onBrushChange) {
			const s = Math.min(brushStart, brushEnd);
			const e = Math.max(brushStart, brushEnd);
			onBrushChange(s, e);
		}
		setSelecting(false);
	}, [selecting, brushStart, brushEnd, onBrushChange]);

	if (data.length === 0) return null;

	return (
		<div className="shrink-0 border-b border-border px-4 py-2">
			<div className="h-16">
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart
						data={data}
						margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
						onMouseDown={handleMouseDown as never}
						onMouseMove={handleMouseMove as never}
						onMouseUp={handleMouseUp}
					>
						<XAxis
							dataKey="time"
							tickFormatter={(ts) => formatTimeLabel(ts, timeRange.rangeMs)}
							tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
							axisLine={false}
							tickLine={false}
							interval="preserveStartEnd"
							minTickGap={60}
						/>
						<YAxis hide />
						<Tooltip
							contentStyle={{
								fontSize: 11,
								background: "var(--color-popover)",
								border: "1px solid var(--color-border)",
								borderRadius: 6,
							}}
							labelFormatter={(ts) =>
								new Date(Number(ts)).toLocaleTimeString("en-US", { hour12: false })
							}
							formatter={(value: number, name: string) => [value, name]}
						/>
						<Area
							type="monotone"
							dataKey="error"
							stackId="1"
							fill={LEVEL_COLORS.error}
							stroke="none"
							fillOpacity={0.85}
						/>
						<Area
							type="monotone"
							dataKey="fatal"
							stackId="1"
							fill={LEVEL_COLORS.fatal}
							stroke="none"
							fillOpacity={0.85}
						/>
						<Area
							type="monotone"
							dataKey="warn"
							stackId="1"
							fill={LEVEL_COLORS.warn}
							stroke="none"
							fillOpacity={0.6}
						/>
						<Area
							type="monotone"
							dataKey="info"
							stackId="1"
							fill={LEVEL_COLORS.info}
							stroke="none"
							fillOpacity={0.5}
						/>
						<Area
							type="monotone"
							dataKey="debug"
							stackId="1"
							fill={LEVEL_COLORS.debug}
							stroke="none"
							fillOpacity={0.3}
						/>
						<Area
							type="monotone"
							dataKey="trace"
							stackId="1"
							fill={LEVEL_COLORS.trace}
							stroke="none"
							fillOpacity={0.2}
						/>
						{selecting && brushStart !== null && brushEnd !== null && (
							<ReferenceArea
								x1={Math.min(brushStart, brushEnd)}
								x2={Math.max(brushStart, brushEnd)}
								fill="var(--color-primary)"
								fillOpacity={0.15}
								stroke="var(--color-primary)"
								strokeOpacity={0.4}
							/>
						)}
					</AreaChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}
```

**Step 2: Verify build**

```bash
cd app && bun run build
```

**Step 3: Commit**

```bash
git add app/src/components/timeline-strip.tsx
git commit -m "feat(app): add recharts timeline strip with stacked area chart and brush selection"
```

---

## Phase 4: Enhanced Log Detail Panel

### Task 10: Convert log detail to right-side slide panel with actions

**Files:**

- Modify: `app/src/components/log-detail.tsx`
- Modify: `app/src/components/log-table.tsx`

**Step 1: Rewrite log-detail.tsx as a right-side panel with Context, Trace, and Copy buttons**

```tsx
import { useState, useCallback } from "react";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";
import { JsonViewer } from "./json-viewer";
import { LogRow } from "./log-row";
import { X, Copy, Route, Rows3, Check } from "lucide-react";
import { apiGet } from "@/api/client";
import type { LogsResponse } from "@/types";

function parseMeta(meta: LogRecord["meta"]): Record<string, unknown> | null {
	if (!meta) return null;
	if (typeof meta === "string") {
		try {
			return JSON.parse(meta);
		} catch {
			return null;
		}
	}
	return meta;
}

function Field({
	label,
	value,
	onClick,
}: {
	label: string;
	value: string | number | null | undefined;
	onClick?: () => void;
}) {
	if (value === null || value === undefined) return null;
	return (
		<div className="flex items-baseline gap-2">
			<span className="shrink-0 text-muted-foreground text-xs w-24">{label}</span>
			{onClick ? (
				<button
					type="button"
					onClick={onClick}
					className="font-mono text-xs break-all text-primary hover:underline"
				>
					{String(value)}
				</button>
			) : (
				<span className="font-mono text-xs break-all">{String(value)}</span>
			)}
		</div>
	);
}

export function LogDetailPanel({
	log,
	onClose,
	onNavigateTrace,
}: {
	log: LogRecord;
	onClose: () => void;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const meta = parseMeta(log.meta);
	const [copied, setCopied] = useState(false);
	const [contextLogs, setContextLogs] = useState<LogRecord[] | null>(null);
	const [loadingContext, setLoadingContext] = useState(false);

	const copyAsJson = useCallback(() => {
		navigator.clipboard.writeText(JSON.stringify(log, null, 2));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [log]);

	const loadContext = useCallback(async () => {
		setLoadingContext(true);
		try {
			// Get logs around this log's timestamp (±5 logs)
			const before = await apiGet<LogsResponse>("/logs", {
				to: log.timestamp,
				limit: "5",
				...(log.service ? { service: log.service } : {}),
			});
			const after = await apiGet<LogsResponse>("/logs", {
				from: log.timestamp,
				limit: "6",
				...(log.service ? { service: log.service } : {}),
			});
			const all = [...(before.rows || []), ...(after.rows || [])];
			const unique = Array.from(new Map(all.map((l) => [l.id, l])).values());
			unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			setContextLogs(unique);
		} catch {
			setContextLogs([]);
		} finally {
			setLoadingContext(false);
		}
	}, [log]);

	return (
		<div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-2">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium">Log #{log.id}</span>
					<LevelBadge level={log.level} />
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<div className="space-y-1.5">
					<Field label="timestamp" value={log.timestamp} />
					<Field label="level" value={log.level} />
					<Field label="service" value={log.service} />
					<Field label="host" value={log.host} />
					<Field label="pid" value={log.pid} />
					<Field
						label="trace_id"
						value={log.trace_id}
						onClick={
							log.trace_id && onNavigateTrace ? () => onNavigateTrace(log.trace_id!) : undefined
						}
					/>
					<Field label="span_id" value={log.span_id} />
					<Field label="project" value={log.project} />
					<Field label="branch" value={log.branch} />
					<Field label="version" value={log.version} />
					<Field label="deployment_id" value={log.deployment_id} />
				</div>

				<div>
					<span className="text-xs text-muted-foreground">message</span>
					<p className="mt-1 rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-all">
						{log.message}
					</p>
				</div>

				{meta && (
					<div>
						<span className="text-xs text-muted-foreground">meta</span>
						<div className="mt-1">
							<JsonViewer data={meta} />
						</div>
					</div>
				)}

				{contextLogs && (
					<div>
						<span className="text-xs text-muted-foreground">Context</span>
						<div className="mt-1 rounded-md border border-border overflow-hidden divide-y divide-border/50">
							{contextLogs.map((l) => (
								<LogRow key={l.id} log={l} selected={l.id === log.id} />
							))}
						</div>
					</div>
				)}
			</div>

			<div className="flex items-center gap-1 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={loadContext}
					disabled={loadingContext}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
				>
					<Rows3 className="h-3 w-3" />
					Context
				</button>
				{log.trace_id && onNavigateTrace && (
					<button
						type="button"
						onClick={() => onNavigateTrace(log.trace_id!)}
						className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Route className="h-3 w-3" />
						Trace
					</button>
				)}
				<div className="flex-1" />
				<button
					type="button"
					onClick={copyAsJson}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
```

**Step 2: Update log-table.tsx to render detail panel as a right-side sibling instead of bottom panel**

Change the layout so the table and detail panel sit side by side in a flex row. The detail panel is now `LogDetailPanel` (renamed import). Add `onNavigateTrace` prop threading.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogRecord } from "@/types";
import { LogRow } from "./log-row";
import { LogDetailPanel } from "./log-detail";

export function LogTable({
	logs,
	autoScroll = false,
	showDate = false,
	emptyMessage = "No logs",
	onNavigateTrace,
}: {
	logs: LogRecord[];
	autoScroll?: boolean;
	showDate?: boolean;
	emptyMessage?: string;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(autoScroll);

	const selectedLog = selectedId !== null ? logs.find((l) => l.id === selectedId) : null;

	const handleScroll = useCallback(() => {
		if (!autoScroll || !scrollRef.current) return;
		const el = scrollRef.current;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		stickToBottomRef.current = atBottom;
	}, [autoScroll]);

	useEffect(() => {
		if (!autoScroll || !stickToBottomRef.current || !scrollRef.current) return;
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
	}, [logs, autoScroll]);

	if (logs.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="flex flex-1 overflow-hidden">
			<div className="flex flex-1 flex-col overflow-hidden">
				<div
					ref={scrollRef}
					onScroll={handleScroll}
					className="flex-1 overflow-y-auto divide-y divide-border/50"
				>
					{logs.map((log) => (
						<LogRow
							key={log.id}
							log={log}
							showDate={showDate}
							selected={log.id === selectedId}
							onClick={() => setSelectedId(log.id === selectedId ? null : log.id)}
						/>
					))}
				</div>
			</div>
			{selectedLog && (
				<LogDetailPanel
					log={selectedLog}
					onClose={() => setSelectedId(null)}
					onNavigateTrace={onNavigateTrace}
				/>
			)}
		</div>
	);
}
```

**Step 3: Verify build**

```bash
cd app && bun run build
```

**Step 4: Commit**

```bash
git add app/src/components/log-detail.tsx app/src/components/log-table.tsx
git commit -m "feat(app): convert log detail to right-side panel with context, trace, and copy actions"
```

---

## Phase 5: Enhanced Views

### Task 11: Update Live view with timeline strip

**Files:**

- Modify: `app/src/views/live.tsx`

**Step 1: Add timeline strip and onNavigateTrace threading**

Add the TimelineStrip component between the status bar and log table. The live view auto-refreshes the timeline every 10 seconds. Thread `onNavigateTrace` through to LogTable.

The live view needs a prop `onNavigateTrace` passed from App.tsx.

```tsx
import { useState } from "react";
import { useStream } from "@/hooks/use-stream";
import { LogTable } from "@/components/log-table";
import { TimelineStrip } from "@/components/timeline-strip";
import type { Filters } from "@/types";
import { Circle, Pause, Play, Trash2 } from "lucide-react";

export function LiveView({
	filters,
	enabled,
	onNavigateTrace,
}: {
	filters: Filters;
	enabled: boolean;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const { logs, connected, paused, pause, resume, clear } = useStream(filters, enabled);
	const [refreshKey, setRefreshKey] = useState(0);

	// Auto-refresh timeline every 10s
	useState(() => {
		const interval = setInterval(() => setRefreshKey((k) => k + 1), 10_000);
		return () => clearInterval(interval);
	});

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
				<div className="flex items-center gap-1.5">
					<Circle
						className={`h-2 w-2 ${connected ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
					/>
					<span className="text-[10px] text-muted-foreground">
						{connected ? "Connected" : paused ? "Paused" : "Disconnected"}
					</span>
				</div>
				<span className="text-[10px] text-muted-foreground tabular-nums">
					{logs.length.toLocaleString()} events
				</span>
				<div className="flex-1" />
				<button
					type="button"
					onClick={clear}
					className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Trash2 className="h-3 w-3" />
					Clear
				</button>
				<button
					type="button"
					onClick={paused ? resume : pause}
					className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{paused ? (
						<>
							<Play className="h-3 w-3" />
							Resume
						</>
					) : (
						<>
							<Pause className="h-3 w-3" />
							Pause
						</>
					)}
				</button>
			</div>
			<TimelineStrip
				from="15m"
				filters={filters as Record<string, string | undefined>}
				refreshKey={refreshKey}
				buckets={45}
			/>
			<LogTable
				logs={logs}
				autoScroll
				emptyMessage={connected ? "Waiting for logs..." : "Not connected"}
				onNavigateTrace={onNavigateTrace}
			/>
		</div>
	);
}
```

**Step 2: Update App.tsx to thread onNavigateTrace**

In App.tsx, create a helper:

```typescript
const navigateTrace = useCallback(
	(traceId: string) => {
		updateFilter("trace_id", traceId);
		setView("traces" as View);
	},
	[updateFilter, setView],
);
```

Pass `onNavigateTrace={navigateTrace}` to LiveView and ExploreView.

**Step 3: Verify build**

```bash
cd app && bun run build
```

**Step 4: Commit**

```bash
git add app/src/views/live.tsx app/src/App.tsx
git commit -m "feat(app): add timeline strip to live view, wire up trace navigation"
```

---

### Task 12: Update Explore view with timeline strip and enhanced features

**Files:**

- Modify: `app/src/views/explore.tsx`

**Step 1: Add timeline strip and export button**

Add the timeline strip at the top. Add an Export dropdown button next to Refresh. Thread `onNavigateTrace`.

```tsx
import { useState, useCallback } from "react";
import { useLogs } from "@/hooks/use-logs";
import { LogTable } from "@/components/log-table";
import { Pagination } from "@/components/pagination";
import { TimelineStrip } from "@/components/timeline-strip";
import type { Filters } from "@/types";
import { Loader2, RefreshCw, Download } from "lucide-react";

export function ExploreView({
	filters,
	page,
	onPageChange,
	enabled,
	onNavigateTrace,
}: {
	filters: Filters;
	page: number;
	onPageChange: (page: number) => void;
	enabled: boolean;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const { data, loading, error, refetch } = useLogs(filters, page, enabled);
	const [showExport, setShowExport] = useState(false);

	const exportData = useCallback(
		(format: "json" | "csv") => {
			if (!data?.rows) return;
			let content: string;
			let mime: string;
			let ext: string;

			if (format === "csv") {
				const headers = [
					"id",
					"timestamp",
					"level",
					"message",
					"service",
					"project",
					"branch",
					"trace_id",
					"meta",
				];
				const rows = data.rows.map((r) =>
					headers
						.map((h) => {
							const val = r[h as keyof typeof r];
							if (val === null || val === undefined) return "";
							const str = typeof val === "object" ? JSON.stringify(val) : String(val);
							return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
						})
						.join(","),
				);
				content = [headers.join(","), ...rows].join("\n");
				mime = "text/csv";
				ext = "csv";
			} else {
				content = JSON.stringify(data.rows, null, 2);
				mime = "application/json";
				ext = "json";
			}

			const blob = new Blob([content], { type: mime });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `relog-export-${Date.now()}.${ext}`;
			a.click();
			URL.revokeObjectURL(url);
			setShowExport(false);
		},
		[data],
	);

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineStrip
				from={filters.from}
				to={filters.to}
				filters={filters as Record<string, string | undefined>}
				refreshKey={data ? 1 : 0}
			/>
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
				{loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
				{error && <span className="text-xs text-destructive">{error}</span>}
				{data && !loading && (
					<span className="text-[10px] text-muted-foreground">
						{data.total.toLocaleString()} results
						{data.total > 0 && ` (${data.rows.length} shown)`}
					</span>
				)}
				<div className="flex-1" />
				<div className="relative">
					<button
						type="button"
						onClick={() => setShowExport(!showExport)}
						className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Download className="h-3 w-3" />
						Export
					</button>
					{showExport && (
						<div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
							<button
								type="button"
								onClick={() => exportData("json")}
								className="block w-full rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted"
							>
								Download JSON
							</button>
							<button
								type="button"
								onClick={() => exportData("csv")}
								className="block w-full rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted"
							>
								Download CSV
							</button>
						</div>
					)}
				</div>
				<button
					type="button"
					onClick={refetch}
					className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<RefreshCw className="h-3 w-3" />
					Refresh
				</button>
			</div>
			<LogTable
				logs={data?.rows ?? []}
				showDate
				emptyMessage={loading ? "Loading..." : "No logs found"}
				onNavigateTrace={onNavigateTrace}
			/>
			{data && (
				<Pagination page={page} total={data.total} limit={data.limit} onPageChange={onPageChange} />
			)}
		</div>
	);
}
```

**Step 2: Verify build**

```bash
cd app && bun run build
```

**Step 3: Commit**

```bash
git add app/src/views/explore.tsx
git commit -m "feat(app): add timeline strip and export to explore view"
```

---

### Task 13: Build Traces view

**Files:**

- Modify: `app/src/views/traces.tsx`

**Step 1: Implement full traces view with trace list and waterfall**

This view:

1. Queries for distinct trace_ids with aggregated info
2. Shows a list of traces with span count, duration, status, services
3. Expanding a trace shows waterfall timeline + log list
4. Uses Recharts BarChart for the waterfall

```tsx
import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/api/client";
import { TimelineStrip } from "@/components/timeline-strip";
import { LevelBadge } from "@/components/level-badge";
import type { Filters, LogLevel, LogRecord, QueryResult } from "@/types";
import { ChevronRight, ChevronDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

interface TraceRow {
	trace_id: string;
	first_ts: string;
	span_count: number;
	duration_ms: number;
	max_level: string;
	services: string;
}

interface SpanBar {
	name: string;
	service: string;
	start: number;
	duration: number;
	level: string;
}

const SERVICE_COLORS = [
	"oklch(0.7 0.15 250)",
	"oklch(0.7 0.15 160)",
	"oklch(0.7 0.15 50)",
	"oklch(0.7 0.15 320)",
	"oklch(0.7 0.15 100)",
	"oklch(0.7 0.15 200)",
];

function levelPriority(level: string): number {
	return { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 }[level] ?? 2;
}

export function TracesView({ filters, enabled }: { filters: Filters; enabled: boolean }) {
	const [traces, setTraces] = useState<TraceRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
	const [traceLogs, setTraceLogs] = useState<LogRecord[]>([]);
	const [traceSpans, setTraceSpans] = useState<SpanBar[]>([]);

	useEffect(() => {
		if (!enabled) return;
		setLoading(true);

		let where = "WHERE trace_id IS NOT NULL AND trace_id != ''";
		if (filters.trace_id) where += ` AND trace_id = '${filters.trace_id}'`;
		if (filters.service) where += ` AND service = '${filters.service}'`;
		if (filters.project) where += ` AND project = '${filters.project}'`;
		if (filters.from) {
			const match = filters.from.match(/^(\d+)([smhd])$/);
			if (match) {
				const ms = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 }[match[2]] ?? 3600_000;
				where += ` AND created_at > ${Date.now() - parseInt(match[1]) * ms}`;
			}
		}

		const sql = `
      SELECT
        trace_id,
        MIN(timestamp) as first_ts,
        COUNT(DISTINCT span_id) as span_count,
        MAX(CASE WHEN json_extract(meta, '$.duration_ms') IS NOT NULL THEN json_extract(meta, '$.duration_ms') ELSE 0 END) as duration_ms,
        MAX(CASE
          WHEN level = 'fatal' THEN 'fatal'
          WHEN level = 'error' THEN 'error'
          WHEN level = 'warn' THEN 'warn'
          ELSE 'info'
        END) as max_level,
        GROUP_CONCAT(DISTINCT service) as services
      FROM logs
      ${where}
      GROUP BY trace_id
      ORDER BY MIN(created_at) DESC
      LIMIT 100
    `;

		apiPost<QueryResult>("/query", { sql })
			.then((res) => {
				setTraces(
					res.rows.map((r) => ({
						trace_id: r.trace_id as string,
						first_ts: r.first_ts as string,
						span_count: Number(r.span_count),
						duration_ms: Number(r.duration_ms),
						max_level: r.max_level as string,
						services: r.services as string,
					})),
				);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [enabled, filters]);

	const expandTrace = useCallback(
		async (traceId: string) => {
			if (expandedTrace === traceId) {
				setExpandedTrace(null);
				return;
			}
			setExpandedTrace(traceId);

			const sql = `SELECT * FROM logs WHERE trace_id = '${traceId}' ORDER BY created_at ASC LIMIT 200`;
			const res = await apiPost<QueryResult>("/query", { sql });
			const logs = res.rows as unknown as LogRecord[];
			setTraceLogs(logs);

			// Build spans from wide events (meta.event = true) or group by span_id
			const spans: SpanBar[] = [];
			const baseTime = logs.length > 0 ? new Date(logs[0].timestamp).getTime() : 0;
			const serviceColorMap = new Map<string, string>();
			let colorIdx = 0;

			const wideEvents = logs.filter((l) => {
				const meta = typeof l.meta === "string" ? JSON.parse(l.meta || "{}") : l.meta || {};
				return meta.event === true || meta.duration_ms;
			});

			if (wideEvents.length > 0) {
				for (const ev of wideEvents) {
					const meta = typeof ev.meta === "string" ? JSON.parse(ev.meta || "{}") : ev.meta || {};
					const service = ev.service || "unknown";
					if (!serviceColorMap.has(service)) {
						serviceColorMap.set(service, SERVICE_COLORS[colorIdx % SERVICE_COLORS.length]);
						colorIdx++;
					}
					spans.push({
						name: ev.message,
						service,
						start: new Date(ev.timestamp).getTime() - baseTime - (meta.duration_ms || 0),
						duration: meta.duration_ms || 1,
						level: ev.level,
					});
				}
			} else {
				// Group by span_id
				const spanGroups = new Map<string, LogRecord[]>();
				for (const l of logs) {
					const key = l.span_id || l.service || "unknown";
					if (!spanGroups.has(key)) spanGroups.set(key, []);
					spanGroups.get(key)!.push(l);
				}
				for (const [key, group] of spanGroups) {
					const service = group[0].service || "unknown";
					if (!serviceColorMap.has(service)) {
						serviceColorMap.set(service, SERVICE_COLORS[colorIdx % SERVICE_COLORS.length]);
						colorIdx++;
					}
					const start = new Date(group[0].timestamp).getTime() - baseTime;
					const end = new Date(group[group.length - 1].timestamp).getTime() - baseTime;
					const maxLevel = group.reduce(
						(max, l) => (levelPriority(l.level) > levelPriority(max) ? l.level : max),
						"info",
					);
					spans.push({
						name: key,
						service,
						start,
						duration: Math.max(end - start, 1),
						level: maxLevel,
					});
				}
			}

			setTraceSpans(spans);
		},
		[expandedTrace],
	);

	const statusDot = (level: string) => {
		const colors: Record<string, string> = {
			fatal: "bg-fuchsia-400",
			error: "bg-red-400",
			warn: "bg-amber-400",
			info: "bg-emerald-400",
		};
		return colors[level] || colors.info;
	};

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineStrip
				from={filters.from || "1h"}
				filters={filters as Record<string, string | undefined>}
			/>
			<div className="flex-1 overflow-y-auto">
				{loading && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						Loading traces...
					</div>
				)}
				{!loading && traces.length === 0 && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						No traces found. Logs need trace_id to appear here.
					</div>
				)}
				<div className="divide-y divide-border/50">
					{traces.map((t) => (
						<div key={t.trace_id}>
							<button
								type="button"
								onClick={() => expandTrace(t.trace_id)}
								className="flex w-full items-center gap-3 px-4 py-2 text-left font-mono text-xs transition-colors hover:bg-muted/50"
							>
								{expandedTrace === t.trace_id ? (
									<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
								)}
								<span className="w-32 shrink-0 truncate text-primary">{t.trace_id}</span>
								<span className="w-24 shrink-0 text-muted-foreground tabular-nums">
									{new Date(t.first_ts).toLocaleTimeString("en-US", { hour12: false })}
								</span>
								<span className="w-16 shrink-0 tabular-nums">{t.span_count} spans</span>
								<span className="w-20 shrink-0 tabular-nums">
									{t.duration_ms > 0 ? `${t.duration_ms}ms` : "—"}
								</span>
								<span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(t.max_level)}`} />
								<span className="min-w-0 flex-1 truncate text-muted-foreground">{t.services}</span>
							</button>

							{expandedTrace === t.trace_id && (
								<div className="border-t border-border/50 bg-muted/20 px-4 py-4 space-y-4">
									{/* Waterfall */}
									{traceSpans.length > 0 && (
										<div>
											<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
												Waterfall
											</div>
											<div className="space-y-1">
												{traceSpans.map((span, i) => {
													const maxEnd = Math.max(
														...traceSpans.map((s) => s.start + s.duration),
														1,
													);
													const leftPct = (span.start / maxEnd) * 100;
													const widthPct = Math.max((span.duration / maxEnd) * 100, 0.5);
													const isError = levelPriority(span.level) >= 4;
													return (
														<div key={i} className="flex items-center gap-2">
															<span className="w-24 shrink-0 truncate text-[10px] text-muted-foreground">
																{span.service}
															</span>
															<div className="relative h-5 flex-1 rounded bg-muted/30">
																<div
																	className={`absolute top-0 h-full rounded text-[9px] flex items-center px-1 text-white font-medium truncate ${isError ? "bg-red-500/80" : "bg-primary/60"}`}
																	style={{
																		left: `${leftPct}%`,
																		width: `${widthPct}%`,
																		minWidth: "2px",
																	}}
																>
																	{widthPct > 8 ? span.name : ""}
																</div>
															</div>
															<span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
																{span.duration}ms
															</span>
														</div>
													);
												})}
											</div>
										</div>
									)}

									{/* Trace logs */}
									<div>
										<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
											Logs ({traceLogs.length})
										</div>
										<div className="rounded-md border border-border overflow-hidden divide-y divide-border/50">
											{traceLogs.map((l) => (
												<div
													key={l.id}
													className="flex items-center gap-3 px-3 py-1 font-mono text-xs"
												>
													<span className="shrink-0 text-muted-foreground tabular-nums">
														{new Date(l.timestamp).toLocaleTimeString("en-US", {
															hour12: false,
															fractionalSecondDigits: 3,
														})}
													</span>
													<LevelBadge level={l.level} />
													{l.service && (
														<span className="shrink-0 text-muted-foreground">{l.service}</span>
													)}
													<span className="min-w-0 flex-1 truncate">{l.message}</span>
												</div>
											))}
										</div>
									</div>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
```

**Step 2: Update filter-bar.tsx to show trace_id input for traces view**

In the filter bar, add a trace_id input when `view === "traces"`:

```tsx
{
	view === "traces" && (
		<input
			type="text"
			placeholder="Trace ID"
			value={filters.trace_id || ""}
			onChange={(e) => onUpdateFilter("trace_id", e.target.value || undefined)}
			className="h-7 w-36 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring font-mono"
		/>
	);
}
```

Also show grep + time presets for traces view (same as explore).

**Step 3: Verify build**

```bash
cd app && bun run build
```

**Step 4: Commit**

```bash
git add app/src/views/traces.tsx app/src/components/layout/filter-bar.tsx
git commit -m "feat(app): implement traces view with waterfall visualization and trace log grouping"
```

---

### Task 14: Build Query workbench

**Files:**

- Modify: `app/src/views/query.tsx`

**Step 1: Implement full query workbench**

The query view has:

- CodeMirror SQL editor with syntax highlighting
- Templates dropdown, Saved Queries dropdown, History dropdown
- Run button (Cmd+Enter), Save button, Export dropdown
- Results table with sortable columns
- Query execution time display

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryExecute } from "@/hooks/use-query-execute";
import { useKeyboard } from "@/hooks/use-keyboard";
import {
	Play,
	Save,
	Download,
	Clock,
	Star,
	FileText,
	ChevronDown,
	X,
	ArrowUpDown,
} from "lucide-react";

// CodeMirror imports
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

const STORAGE_SAVED = "relog:saved-queries";
const STORAGE_HISTORY = "relog:query-history";
const MAX_HISTORY = 20;

const TEMPLATES = [
	{
		name: "Logs by level (last 1h)",
		sql: `SELECT level, COUNT(*) as count FROM logs WHERE created_at > ${Date.now() - 3600_000} GROUP BY level ORDER BY count DESC`,
	},
	{
		name: "Logs by service (last 24h)",
		sql: `SELECT service, COUNT(*) as count FROM logs WHERE created_at > ${Date.now() - 86400_000} AND service IS NOT NULL GROUP BY service ORDER BY count DESC`,
	},
	{
		name: "Errors by service",
		sql: `SELECT service, COUNT(*) as count FROM logs WHERE level IN ('error', 'fatal') AND service IS NOT NULL GROUP BY service ORDER BY count DESC`,
	},
	{
		name: "Slowest wide events",
		sql: `SELECT message, service, json_extract(meta, '$.duration_ms') as duration_ms FROM logs WHERE json_extract(meta, '$.event') = 1 ORDER BY json_extract(meta, '$.duration_ms') DESC LIMIT 20`,
	},
	{
		name: "Logs per minute (last 1h)",
		sql: `SELECT datetime(created_at/1000, 'unixepoch', 'localtime') as minute, COUNT(*) as count FROM logs WHERE created_at > ${Date.now() - 3600_000} GROUP BY strftime('%Y-%m-%d %H:%M', datetime(created_at/1000, 'unixepoch', 'localtime')) ORDER BY minute`,
	},
	{
		name: "Top error messages",
		sql: `SELECT message, COUNT(*) as count FROM logs WHERE level IN ('error', 'fatal') GROUP BY message ORDER BY count DESC LIMIT 20`,
	},
	{
		name: "Trace durations",
		sql: `SELECT trace_id, MIN(timestamp) as started, COUNT(*) as log_count, MAX(CASE WHEN json_extract(meta, '$.duration_ms') IS NOT NULL THEN json_extract(meta, '$.duration_ms') ELSE 0 END) as duration_ms FROM logs WHERE trace_id IS NOT NULL GROUP BY trace_id ORDER BY duration_ms DESC LIMIT 20`,
	},
	{
		name: "Logs by project & branch",
		sql: `SELECT project, branch, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project, branch ORDER BY count DESC`,
	},
	{
		name: "Recent deployments",
		sql: `SELECT deployment_id, version, MIN(timestamp) as first_seen, COUNT(*) as log_count FROM logs WHERE deployment_id IS NOT NULL GROUP BY deployment_id, version ORDER BY first_seen DESC LIMIT 20`,
	},
];

const COLUMNS = [
	"id",
	"timestamp",
	"level",
	"message",
	"meta",
	"service",
	"host",
	"pid",
	"trace_id",
	"span_id",
	"project",
	"branch",
	"version",
	"deployment_id",
	"key_prefix",
	"created_at",
];

interface SavedQuery {
	name: string;
	sql: string;
}

interface HistoryEntry {
	sql: string;
	time: number;
}

function loadSaved(): SavedQuery[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_SAVED) || "[]");
	} catch {
		return [];
	}
}

function saveSaved(queries: SavedQuery[]) {
	localStorage.setItem(STORAGE_SAVED, JSON.stringify(queries));
}

function loadHistory(): HistoryEntry[] {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]");
	} catch {
		return [];
	}
}

function addHistory(entry: string) {
	const history = loadHistory().filter((h) => h.sql !== entry);
	history.unshift({ sql: entry, time: Date.now() });
	if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
	localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history));
}

export function QueryView({ enabled }: { enabled: boolean }) {
	const { data, loading, error, execute } = useQueryExecute();
	const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
	const [savedQueries, setSavedQueries] = useState(loadSaved);
	const [queryHistory, setQueryHistory] = useState(loadHistory);
	const [sortCol, setSortCol] = useState<string | null>(null);
	const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
	const [showExport, setShowExport] = useState(false);
	const editorRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);

	// Initialize CodeMirror
	useEffect(() => {
		if (!editorRef.current || viewRef.current) return;

		const isDark = document.documentElement.classList.contains("dark");

		const extensions = [
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			sql({ dialect: SQLite, upperCaseKeywords: true, schema: { logs: COLUMNS } }),
			autocompletion(),
			EditorView.lineWrapping,
			cmPlaceholder("SELECT * FROM logs LIMIT 10"),
			EditorView.theme({
				"&": { fontSize: "12px", maxHeight: "200px" },
				".cm-scroller": { overflow: "auto" },
				".cm-content": { fontFamily: "var(--font-mono)", padding: "8px 0" },
				".cm-gutters": {
					backgroundColor: "transparent",
					border: "none",
					color: "var(--color-muted-foreground)",
				},
			}),
		];

		if (isDark) {
			extensions.push(oneDark);
		} else {
			extensions.push(syntaxHighlighting(defaultHighlightStyle));
		}

		const state = EditorState.create({
			doc: "SELECT * FROM logs ORDER BY created_at DESC LIMIT 100",
			extensions,
		});

		viewRef.current = new EditorView({
			state,
			parent: editorRef.current,
		});

		return () => {
			viewRef.current?.destroy();
			viewRef.current = null;
		};
	}, []);

	const getEditorContent = useCallback(() => {
		return viewRef.current?.state.doc.toString() || "";
	}, []);

	const setEditorContent = useCallback((content: string) => {
		const view = viewRef.current;
		if (!view) return;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: content },
		});
	}, []);

	const runQuery = useCallback(async () => {
		const sqlStr = getEditorContent().trim();
		if (!sqlStr) return;
		addHistory(sqlStr);
		setQueryHistory(loadHistory());
		await execute(sqlStr);
	}, [execute, getEditorContent]);

	const saveQuery = useCallback(() => {
		const sqlStr = getEditorContent().trim();
		if (!sqlStr) return;
		const name = prompt("Query name:");
		if (!name) return;
		const updated = [...savedQueries.filter((q) => q.name !== name), { name, sql: sqlStr }];
		setSavedQueries(updated);
		saveSaved(updated);
	}, [getEditorContent, savedQueries]);

	const deleteQuery = useCallback(
		(name: string) => {
			const updated = savedQueries.filter((q) => q.name !== name);
			setSavedQueries(updated);
			saveSaved(updated);
		},
		[savedQueries],
	);

	const keyMap = useMemo(
		() => ({
			"cmd+Enter": runQuery,
		}),
		[runQuery],
	);
	useKeyboard(keyMap);

	const sortedRows = useMemo(() => {
		if (!data?.rows || !sortCol) return data?.rows ?? [];
		return [...data.rows].sort((a, b) => {
			const va = a[sortCol] ?? "";
			const vb = b[sortCol] ?? "";
			const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
			return sortDir === "asc" ? cmp : -cmp;
		});
	}, [data?.rows, sortCol, sortDir]);

	const columns = useMemo(() => {
		if (!data?.rows?.length) return [];
		return Object.keys(data.rows[0]);
	}, [data?.rows]);

	const exportResults = useCallback(
		(format: "json" | "csv") => {
			if (!data?.rows) return;
			let content: string;
			let ext: string;
			if (format === "csv") {
				const cols = Object.keys(data.rows[0] || {});
				const rows = data.rows.map((r) =>
					cols
						.map((c) => {
							const v = r[c];
							const s =
								v === null || v === undefined
									? ""
									: typeof v === "object"
										? JSON.stringify(v)
										: String(v);
							return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
						})
						.join(","),
				);
				content = [cols.join(","), ...rows].join("\n");
				ext = "csv";
			} else {
				content = JSON.stringify(data.rows, null, 2);
				ext = "json";
			}
			const blob = new Blob([content], {
				type: format === "csv" ? "text/csv" : "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `relog-query-${Date.now()}.${ext}`;
			a.click();
			URL.revokeObjectURL(url);
			setShowExport(false);
		},
		[data],
	);

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Toolbar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
				{/* Templates */}
				<div className="relative">
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "templates" ? null : "templates")}
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<FileText className="h-3 w-3" />
						Templates
						<ChevronDown className="h-3 w-3" />
					</button>
					{activeDropdown === "templates" && (
						<div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
							{TEMPLATES.map((t) => (
								<button
									key={t.name}
									type="button"
									onClick={() => {
										setEditorContent(t.sql);
										setActiveDropdown(null);
									}}
									className="block w-full rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted truncate"
								>
									{t.name}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Saved */}
				<div className="relative">
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "saved" ? null : "saved")}
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Star className="h-3 w-3" />
						Saved
						<ChevronDown className="h-3 w-3" />
					</button>
					{activeDropdown === "saved" && (
						<div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
							{savedQueries.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground italic">
									No saved queries
								</div>
							) : (
								savedQueries.map((q) => (
									<div key={q.name} className="flex items-center gap-1">
										<button
											type="button"
											onClick={() => {
												setEditorContent(q.sql);
												setActiveDropdown(null);
											}}
											className="flex-1 rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted truncate"
										>
											{q.name}
										</button>
										<button
											type="button"
											onClick={() => deleteQuery(q.name)}
											className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								))
							)}
						</div>
					)}
				</div>

				{/* History */}
				<div className="relative">
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "history" ? null : "history")}
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Clock className="h-3 w-3" />
						History
						<ChevronDown className="h-3 w-3" />
					</button>
					{activeDropdown === "history" && (
						<div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-md border border-border bg-popover p-1 shadow-lg max-h-64 overflow-y-auto">
							{queryHistory.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground italic">No history</div>
							) : (
								queryHistory.map((h, i) => (
									<button
										key={i}
										type="button"
										onClick={() => {
											setEditorContent(h.sql);
											setActiveDropdown(null);
										}}
										className="block w-full rounded px-3 py-1.5 text-left font-mono text-[10px] text-popover-foreground hover:bg-muted truncate"
									>
										<span className="text-muted-foreground mr-2">
											{new Date(h.time).toLocaleTimeString("en-US", {
												hour12: false,
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
										{h.sql.slice(0, 80)}
									</button>
								))
							)}
						</div>
					)}
				</div>
			</div>

			{/* Editor */}
			<div className="shrink-0 border-b border-border">
				<div ref={editorRef} className="min-h-[80px] max-h-[200px]" />
			</div>

			{/* Action bar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
				<button
					type="button"
					onClick={runQuery}
					disabled={loading}
					className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					<Play className="h-3 w-3" />
					Run
					<span className="text-[10px] opacity-70 ml-1">⌘↵</span>
				</button>
				<button
					type="button"
					onClick={saveQuery}
					className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Save className="h-3 w-3" />
					Save
				</button>

				<div className="flex-1" />

				{error && <span className="text-xs text-destructive truncate max-w-xs">{error}</span>}

				{data && (
					<span className="text-[10px] text-muted-foreground tabular-nums">
						{data.time_ms}ms · {data.count} rows
					</span>
				)}

				{data && (
					<div className="relative">
						<button
							type="button"
							onClick={() => setShowExport(!showExport)}
							className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<Download className="h-3 w-3" />
							Export
						</button>
						{showExport && (
							<div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
								<button
									type="button"
									onClick={() => exportResults("json")}
									className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									Download JSON
								</button>
								<button
									type="button"
									onClick={() => exportResults("csv")}
									className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									Download CSV
								</button>
								<button
									type="button"
									onClick={() => {
										navigator.clipboard.writeText(JSON.stringify(data.rows, null, 2));
										setShowExport(false);
									}}
									className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									Copy as JSON
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Results table */}
			<div className="flex-1 overflow-auto">
				{sortedRows.length > 0 ? (
					<table className="w-full border-collapse font-mono text-xs">
						<thead className="sticky top-0 bg-card">
							<tr className="border-b border-border">
								{columns.map((col) => (
									<th
										key={col}
										className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
										onClick={() => {
											if (sortCol === col) {
												setSortDir((d) => (d === "asc" ? "desc" : "asc"));
											} else {
												setSortCol(col);
												setSortDir("asc");
											}
										}}
									>
										<span className="flex items-center gap-1">
											{col}
											{sortCol === col && <ArrowUpDown className="h-3 w-3" />}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody className="divide-y divide-border/50">
							{sortedRows.map((row, i) => (
								<tr key={i} className="hover:bg-muted/30">
									{columns.map((col) => (
										<td key={col} className="px-3 py-1.5 max-w-xs truncate">
											{row[col] === null || row[col] === undefined
												? ""
												: typeof row[col] === "object"
													? JSON.stringify(row[col])
													: String(row[col])}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				) : (
					!loading &&
					!error && (
						<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
							Run a query to see results
						</div>
					)
				)}
			</div>
		</div>
	);
}
```

**Step 2: Verify build**

```bash
cd app && bun run build
```

**Step 3: Commit**

```bash
git add app/src/views/query.tsx
git commit -m "feat(app): implement query workbench with codemirror, templates, saved queries, history, and export"
```

---

## Phase 6: Dashboard Overhaul

### Task 15: Rewrite dashboard with Recharts, time range selector, and auto-refresh

**Files:**

- Modify: `app/src/views/dashboard.tsx`

**Step 1: Rewrite dashboard**

Replace the existing dashboard with:

- Time range selector (1h, 6h, 24h, 7d, 30d)
- Auto-refresh dropdown (off, 10s, 30s, 60s)
- Stat cards (reuse existing)
- Recharts stacked AreaChart for log volume over time
- Recharts horizontal BarChart for "By Level" and "By Service"
- Recent errors section (clickable)

Use `useQueryExecute` for the dashboard queries. All charts respond to the selected time range.

The full implementation should use Recharts `AreaChart` for volume, `BarChart` for level/service breakdowns. Remove the old `LevelChart` component usage in favor of Recharts `BarChart`.

Key structure:

```
Time range tabs + Auto-refresh dropdown
4x StatCards
AreaChart (log volume over time, stacked by level)
Two side-by-side BarCharts (By Level, By Service)
Recent Errors list
```

This is a substantial rewrite — the full code should follow the same patterns as the existing dashboard but swap in Recharts and add time range/auto-refresh.

**Step 2: Verify build**

```bash
cd app && bun run build
```

**Step 3: Commit**

```bash
git add app/src/views/dashboard.tsx
git commit -m "feat(app): rewrite dashboard with recharts, time range selector, auto-refresh, and service breakdown"
```

---

## Phase 7: Command Palette

### Task 16: Create command palette component

**Files:**

- Create: `app/src/components/command-palette.tsx`

**Step 1: Implement command palette**

A modal overlay with:

- Search input at top
- Fuzzy-matched list of commands
- j/k or arrow keys to navigate
- Enter to execute
- Esc to close

Commands:

- Navigate views (Go to Live, Explore, Traces, Query, Dashboard)
- Filter by level (each level as a command)
- Toggle dark mode
- Clear filters
- Run query templates
- Export logs
- Open settings

Each command has a name, optional shortcut display, optional category, and an action callback.

The palette receives `commands` as props from App.tsx, which wires up all the actions.

**Step 2: Wire into App.tsx**

Add the command palette render conditionally when `showCommandPalette` is true. Build the commands array from current context.

**Step 3: Verify build**

```bash
cd app && bun run build
```

**Step 4: Commit**

```bash
git add app/src/components/command-palette.tsx app/src/App.tsx
git commit -m "feat(app): add command palette with fuzzy search, view navigation, filters, and shortcuts"
```

---

## Phase 8: Polish

### Task 17: Add keyboard shortcuts cheatsheet

**Files:**

- Create: `app/src/components/shortcuts-dialog.tsx`

A simple modal showing all keyboard shortcuts in a grid. Toggled by `?` key.

**Step 1: Implement and wire into App.tsx**

**Step 2: Commit**

```bash
git add app/src/components/shortcuts-dialog.tsx app/src/App.tsx
git commit -m "feat(app): add keyboard shortcuts cheatsheet dialog"
```

---

### Task 18: Update filter bar for all views

**Files:**

- Modify: `app/src/components/layout/filter-bar.tsx`

**Step 1: Update filter bar**

- Show version and deployment_id inputs for explore and traces views
- Show trace_id input for traces view
- Show grep + time presets for both explore and traces views
- Keep the existing compact style

**Step 2: Commit**

```bash
git add app/src/components/layout/filter-bar.tsx
git commit -m "feat(app): enhance filter bar with version, deployment_id, and trace_id inputs"
```

---

### Task 19: Final build verification and cleanup

**Step 1: Full build**

```bash
cd app && bun run build
```

**Step 2: Dev server test**

```bash
cd app && bun run dev
```

Manually verify:

- [ ] All 5 tabs navigate correctly
- [ ] Status bar shows health info
- [ ] Live view streams with timeline strip
- [ ] Explore view shows timeline, logs, export, pagination
- [ ] Traces view shows trace list, waterfall expands
- [ ] Query view: CodeMirror works, templates load, Cmd+Enter runs, results sort, export works
- [ ] Dashboard shows time range selector, charts, auto-refresh
- [ ] Cmd+K opens command palette
- [ ] g+l/e/t/q/d navigate views
- [ ] j/k navigate log rows
- [ ] ? shows shortcuts
- [ ] Log detail panel slides in from right with Context/Trace/Copy

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(app): complete UI/UX overhaul - all views, command palette, keyboard shortcuts, timeline strip"
```
