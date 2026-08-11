import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useQueryExecute } from "@/hooks/use-query-execute";
import { useKeyboard } from "@/hooks/use-keyboard";
import { TimelineChart } from "@/components/timeline-chart";
import { LevelBadge } from "@/components/level-badge";
import { formatClockTime as formatCellTimestamp } from "@/lib/format-time";
import type { LogLevel } from "@/types";
import {
	Play,
	Save,
	Download,
	Clock,
	Star,
	FileText,
	ChevronDown,
	X,
	ArrowUp,
	ArrowDown,
	Loader2,
	Copy,
	Hash,
} from "lucide-react";

import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxHighlighting } from "@codemirror/language";
import { sqlEditorTheme, sqlHighlightStyle } from "@/components/sql-editor-theme";

const STORAGE_SAVED = "relog:saved-queries";
const STORAGE_HISTORY = "relog:query-history";
const MAX_HISTORY = 20;

const TEMPLATES = [
	{
		name: "Logs by level (last 1h)",
		sql: "SELECT level, COUNT(*) as count FROM logs WHERE created_at > (strftime('%s','now') * 1000 - 3600000) GROUP BY level ORDER BY count DESC",
	},
	{
		name: "Logs by service (last 24h)",
		sql: "SELECT service, COUNT(*) as count FROM logs WHERE created_at > (strftime('%s','now') * 1000 - 86400000) AND service IS NOT NULL GROUP BY service ORDER BY count DESC",
	},
	{
		name: "Errors by service",
		sql: "SELECT service, COUNT(*) as count FROM logs WHERE level IN ('error', 'fatal') AND service IS NOT NULL GROUP BY service ORDER BY count DESC",
	},
	{
		name: "Slowest wide events",
		sql: "SELECT message, service, json_extract(meta, '$.duration_ms') as duration_ms FROM logs WHERE json_extract(meta, '$.event') = 1 ORDER BY CAST(json_extract(meta, '$.duration_ms') AS REAL) DESC LIMIT 20",
	},
	{
		name: "Logs per minute (last 1h)",
		sql: "SELECT strftime('%H:%M', datetime(created_at/1000, 'unixepoch', 'localtime')) as minute, COUNT(*) as count FROM logs WHERE created_at > (strftime('%s','now') * 1000 - 3600000) GROUP BY minute ORDER BY minute",
	},
	{
		name: "Top error messages",
		sql: "SELECT message, COUNT(*) as count FROM logs WHERE level IN ('error', 'fatal') GROUP BY message ORDER BY count DESC LIMIT 20",
	},
	{
		name: "Trace durations",
		sql: "SELECT trace_id, MIN(timestamp) as started, COUNT(*) as log_count, MAX(CASE WHEN json_extract(meta, '$.duration_ms') IS NOT NULL THEN CAST(json_extract(meta, '$.duration_ms') AS REAL) ELSE 0 END) as duration_ms FROM logs WHERE trace_id IS NOT NULL GROUP BY trace_id ORDER BY duration_ms DESC LIMIT 20",
	},
	{
		name: "Logs by project & branch",
		sql: "SELECT project, branch, COUNT(*) as count FROM logs WHERE project IS NOT NULL GROUP BY project, branch ORDER BY count DESC",
	},
	{
		name: "Recent deployments",
		sql: "SELECT deployment_id, version, MIN(timestamp) as first_seen, COUNT(*) as log_count FROM logs WHERE deployment_id IS NOT NULL GROUP BY deployment_id, version ORDER BY first_seen DESC LIMIT 20",
	},
];

const LOG_COLUMNS = [
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

const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

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
function addToHistory(entry: string) {
	const hist = loadHistory().filter((h) => h.sql !== entry);
	hist.unshift({ sql: entry, time: Date.now() });
	if (hist.length > MAX_HISTORY) hist.length = MAX_HISTORY;
	localStorage.setItem(STORAGE_HISTORY, JSON.stringify(hist));
}

function formatMeta(val: unknown): { short: string; isJson: boolean } {
	if (val === null || val === undefined) return { short: "", isJson: false };
	const str = typeof val === "object" ? JSON.stringify(val) : String(val);
	if (str === "{}" || str === "null") return { short: "", isJson: false };

	try {
		const parsed = typeof val === "object" ? val : JSON.parse(str);
		if (typeof parsed === "object" && parsed !== null) {
			const keys = Object.keys(parsed as Record<string, unknown>);
			if (keys.length === 0) return { short: "", isJson: false };
			const preview = keys
				.slice(0, 3)
				.map((k) => {
					const v = (parsed as Record<string, unknown>)[k];
					const vs = typeof v === "string" ? v : JSON.stringify(v);
					const truncV = vs && vs.length > 16 ? vs.slice(0, 16) + "…" : vs;
					return `${k}: ${truncV}`;
				})
				.join(", ");
			const suffix = keys.length > 3 ? ` +${keys.length - 3}` : "";
			return { short: preview + suffix, isJson: true };
		}
	} catch {
		/* not json */
	}

	return { short: str.length > 60 ? str.slice(0, 60) + "…" : str, isJson: false };
}

function CellValue({ col, value, rowIndex }: { col: string; value: unknown; rowIndex: number }) {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground/40">—</span>;
	}

	const str = typeof value === "object" ? JSON.stringify(value) : String(value);

	// Level column → colored badge
	if (col === "level" && LOG_LEVELS.has(str)) {
		return <LevelBadge level={str as LogLevel} />;
	}

	// ID columns → dimmed mono with hash icon
	if (col === "id") {
		return (
			<span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
				<Hash className="h-2.5 w-2.5 opacity-40" />
				{str}
			</span>
		);
	}

	// Timestamp column → formatted time
	if (col === "timestamp" || col === "first_ts" || col === "started" || col === "first_seen") {
		return <span className="text-muted-foreground tabular-nums">{formatCellTimestamp(str)}</span>;
	}

	// created_at → format as date from epoch ms
	if (col === "created_at") {
		const ms = Number(str);
		if (!isNaN(ms) && ms > 1e12) {
			return (
				<span className="text-muted-foreground tabular-nums">
					{formatCellTimestamp(new Date(ms).toISOString())}
				</span>
			);
		}
	}

	// Meta column → abbreviated JSON preview
	if (col === "meta") {
		const { short, isJson } = formatMeta(value);
		if (!short) return <span className="text-muted-foreground/40">—</span>;
		return (
			<span className={isJson ? "text-muted-foreground" : ""} title={str}>
				{isJson ? `{${short}}` : short}
			</span>
		);
	}

	// Trace ID / Span ID → mono with accent
	if (col === "trace_id" || col === "span_id") {
		return (
			<span className="text-primary/80 tabular-nums">
				{str.length > 12 ? str.slice(0, 12) + "…" : str}
			</span>
		);
	}

	// Service / project / branch → subtle tag
	if (col === "service" || col === "project" || col === "branch") {
		return (
			<span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-2xs font-medium text-foreground/80">
				{str}
			</span>
		);
	}

	// Count / numeric aggregates → right-aligned style
	if (col === "count" || col === "log_count" || col === "span_count") {
		return <span className="tabular-nums font-medium">{Number(str).toLocaleString()}</span>;
	}

	// Duration → with ms suffix
	if (col === "duration_ms") {
		const n = Number(str);
		if (!isNaN(n)) {
			return (
				<span className="tabular-nums">
					{n.toFixed(1)}
					<span className="text-muted-foreground ml-0.5">ms</span>
				</span>
			);
		}
	}

	// PID → dimmed
	if (col === "pid" || col === "host") {
		return <span className="text-muted-foreground tabular-nums">{str}</span>;
	}

	void rowIndex;
	return <>{str}</>;
}

export function QueryView({
	enabled,
	onZoom,
}: {
	enabled: boolean;
	onZoom?: (from: string, to: string) => void;
}) {
	const { data, loading, error, execute } = useQueryExecute();
	const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
	const [savedQueries, setSavedQueries] = useState(loadSaved);
	const [queryHistory, setQueryHistory] = useState(loadHistory);
	const [sortCol, setSortCol] = useHashParam("sort");
	const [sortDirParam, setSortDir] = useHashParam("dir", "asc");
	const sortDir = (sortDirParam ?? "asc") as "asc" | "desc";
	const [, setQueryParam] = useHashParam("q");
	const [showExport, setShowExport] = useState(false);
	const editorRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	// Read initial SQL from URL hash synchronously before editor mounts
	const initialQueryRef = useRef<string | undefined>(
		(() => {
			const hash = window.location.hash.slice(1);
			const [, search] = hash.split("?");
			return new URLSearchParams(search || "").get("q") ?? undefined;
		})(),
	);

	// Both the theme and the highlight style are plain CSS variables, so the
	// editor re-paints with the rest of the app on a theme switch. It used to
	// read `classList.contains("dark")` once at mount with `[]` deps and push
	// `oneDark`, which meant switching to light left a dark slab on a white page
	// until you reloaded.
	useEffect(() => {
		if (!editorRef.current || viewRef.current) return;

		const state = EditorState.create({
			doc: initialQueryRef.current || "SELECT * FROM logs ORDER BY created_at DESC LIMIT 100",
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				sql({ dialect: SQLite, upperCaseKeywords: true, schema: { logs: LOG_COLUMNS } }),
				autocompletion(),
				EditorView.lineWrapping,
				cmPlaceholder("SELECT * FROM logs LIMIT 10"),
				sqlEditorTheme,
				syntaxHighlighting(sqlHighlightStyle),
			],
		});

		viewRef.current = new EditorView({ state, parent: editorRef.current });

		return () => {
			viewRef.current?.destroy();
			viewRef.current = null;
		};
	}, []);

	const getEditorContent = useCallback(() => viewRef.current?.state.doc.toString() || "", []);

	const setEditorContent = useCallback(
		(content: string) => {
			const view = viewRef.current;
			if (!view) return;
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
			setQueryParam(content);
		},
		[setQueryParam],
	);

	const runQuery = useCallback(async () => {
		const sqlStr = getEditorContent().trim();
		if (!sqlStr) return;
		setQueryParam(sqlStr);
		addToHistory(sqlStr);
		setQueryHistory(loadHistory());
		setSortCol(undefined);
		setSortDir("asc");
		await execute(sqlStr);
	}, [execute, getEditorContent, setQueryParam, setSortCol, setSortDir]);

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

	const keyMap = useMemo(() => ({ "cmd+enter": runQuery }), [runQuery]);
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
		(format: "json" | "csv" | "copy") => {
			if (!data?.rows) return;
			if (format === "copy") {
				navigator.clipboard.writeText(JSON.stringify(data.rows, null, 2));
				setShowExport(false);
				return;
			}
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

	useEffect(() => {
		if (!activeDropdown && !showExport) return;
		const handler = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (!target.closest("[data-dropdown]")) {
				setActiveDropdown(null);
				setShowExport(false);
			}
		};
		document.addEventListener("click", handler);
		return () => document.removeEventListener("click", handler);
	}, [activeDropdown, showExport]);

	void enabled;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineChart from="1h" buckets={45} onTimeRangeSelect={onZoom} />

			{/* Editor */}
			<div className="shrink-0 border-b border-border">
				<div ref={editorRef} className="min-h-[80px] max-h-[200px]" />
			</div>

			{/* Unified action bar: run/save + dropdowns + status + export */}
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
				<button
					type="button"
					onClick={runQuery}
					disabled={loading}
					className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
				>
					{loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
					Run
					<kbd className="ml-1 text-2xs opacity-60">{"\u2318\u21B5"}</kbd>
				</button>
				<button
					type="button"
					onClick={saveQuery}
					className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Save className="h-3 w-3" />
				</button>

				<div className="h-4 w-px bg-border mx-0.5" />

				{/* Templates */}
				<div className="relative" data-dropdown>
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "templates" ? null : "templates")}
						className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<FileText className="h-3 w-3" />
						<span className="hidden sm:inline">Templates</span>
						<ChevronDown className="h-2.5 w-2.5 opacity-50" />
					</button>
					{activeDropdown === "templates" && (
						<div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-lg">
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
				<div className="relative" data-dropdown>
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "saved" ? null : "saved")}
						className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Star className="h-3 w-3" />
						<span className="hidden sm:inline">Saved</span>
						<ChevronDown className="h-2.5 w-2.5 opacity-50" />
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
				<div className="relative" data-dropdown>
					<button
						type="button"
						onClick={() => setActiveDropdown(activeDropdown === "history" ? null : "history")}
						className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Clock className="h-3 w-3" />
						<span className="hidden sm:inline">History</span>
						<ChevronDown className="h-2.5 w-2.5 opacity-50" />
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
										className="block w-full rounded px-3 py-1.5 text-left text-2xs text-popover-foreground hover:bg-muted truncate"
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

				<div className="flex-1" />

				{error && <span className="text-xs text-destructive truncate max-w-xs">{error}</span>}

				{data && (
					<span className="text-2xs text-muted-foreground tabular-nums">
						{data.time_ms.toFixed(1)}ms · {data.count.toLocaleString()} rows
					</span>
				)}

				{data && (
					<div className="relative" data-dropdown>
						<button
							type="button"
							onClick={() => setShowExport(!showExport)}
							className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<Download className="h-3 w-3" />
						</button>
						{showExport && (
							<div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-border bg-popover p-1 shadow-md">
								<button
									type="button"
									onClick={() => exportResults("json")}
									className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									<Download className="h-3 w-3 text-muted-foreground" /> JSON
								</button>
								<button
									type="button"
									onClick={() => exportResults("csv")}
									className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									<Download className="h-3 w-3 text-muted-foreground" /> CSV
								</button>
								<button
									type="button"
									onClick={() => exportResults("copy")}
									className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-muted"
								>
									<Copy className="h-3 w-3 text-muted-foreground" /> Copy JSON
								</button>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Results table */}
			<div className="flex-1 overflow-auto">
				{sortedRows.length > 0 ? (
					<table className="w-full border-collapse text-xs">
						<thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
							<tr className="border-b-2 border-border">
								<th className="w-8 px-2 py-2 text-right text-2xs font-medium text-muted-foreground/50">
									#
								</th>
								{columns.map((col) => (
									<th
										key={col}
										className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none transition-colors hover:text-foreground"
										onClick={() => {
											if (sortCol === col) {
												setSortDir(sortDir === "asc" ? "desc" : "asc");
											} else {
												setSortCol(col);
												setSortDir("asc");
											}
										}}
									>
										<span className="inline-flex items-center gap-1">
											{col.replace(/_/g, " ")}
											{sortCol === col &&
												(sortDir === "asc" ? (
													<ArrowUp className="h-3 w-3 text-primary" />
												) : (
													<ArrowDown className="h-3 w-3 text-primary" />
												))}
										</span>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sortedRows.map((row, i) => (
								<tr
									key={i}
									className="border-b border-border/30 transition-colors hover:bg-muted/40 even:bg-muted/10"
								>
									<td className="w-8 px-2 py-1.5 text-right text-2xs text-muted-foreground/40 tabular-nums">
										{i + 1}
									</td>
									{columns.map((col) => (
										<td key={col} className="px-3 py-1.5 max-w-xs truncate">
											<CellValue col={col} value={row[col]} rowIndex={i} />
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				) : (
					!loading &&
					!error && (
						<div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
							<Play className="h-6 w-6 opacity-20" />
							<span className="text-sm">Run a query to see results</span>
							<kbd className="rounded border border-border bg-muted px-2 py-0.5 text-2xs">
								{"\u2318\u21B5"}
							</kbd>
						</div>
					)
				)}
			</div>
		</div>
	);
}
