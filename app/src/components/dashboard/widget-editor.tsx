import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { sql, SQLite } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { X } from "lucide-react";
import { apiPost } from "@/api/client";
import type { DashboardVariable, QueryResult, Widget, WidgetKind, WidgetOptions } from "@/types";
import { WidgetRenderer } from "./widget-renderer";
import { substituteVars, undeclaredPlaceholders } from "./sql-vars";

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
	/** The dashboard this widget belongs to; its variables are in scope. */
	dashboardId: string;
	variables: DashboardVariable[];
	/** Current variable values, used to make the preview match the dashboard. */
	values: Record<string, string>;
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
	const [optionsDraft, setOptionsDraft] = useState(() =>
		JSON.stringify(props.initial?.options ?? DEFAULT_OPTIONS.stat, null, 2),
	);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	const [sqlText, setSqlText] = useState(
		props.initial?.sql ??
			"SELECT COUNT(*) AS value FROM logs WHERE created_at BETWEEN ${from} AND ${to}",
	);
	const [timeRange, setTimeRange] = useState<string | undefined>(props.initial?.timeRange);
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

	// The preview runs with the dashboard's live variable values, so what the
	// author sees while editing is what the tile will show once saved.
	const valuesKey = JSON.stringify(props.values);
	const previewVars = useMemo(() => {
		const vars: Record<string, string | number | null> = {
			from: props.filterFrom,
			to: props.filterTo,
		};
		for (const [k, v] of Object.entries(JSON.parse(valuesKey) as Record<string, string>)) {
			vars[k] = v === "" ? null : v;
		}
		return vars as { from: number; to: number } & Record<string, string | number | null>;
	}, [props.filterFrom, props.filterTo, valuesKey]);

	// A `${typo}` would otherwise become NULL and quietly widen the widget's
	// scope. Surfacing it next to the editor catches it while it is still cheap.
	const undeclared = useMemo(
		() => undeclaredPlaceholders(sqlText, props.variables),
		[sqlText, props.variables],
	);

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

	useEffect(() => {
		const t = setTimeout(async () => {
			setPreviewLoading(true);
			setPreviewError(null);
			try {
				const resolved = substituteVars(sqlText, previewVars, {
					variables: props.variables,
					// The SQL is mid-edit; an as-yet-undeclared placeholder should
					// show up as a warning under the editor, not as a thrown error
					// that blanks the preview on every keystroke.
					lenient: true,
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
	}, [sqlText, previewVars, props.variables]);

	const handleKindChange = useCallback((k: WidgetKind) => {
		setKind(k);
		setOptions(DEFAULT_OPTIONS[k]);
	}, []);

	// Keep draft in sync when kind changes reset options
	useEffect(() => {
		setOptionsDraft(JSON.stringify(options, null, 2));
		setOptionsError(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [kind]);

	const [saving, setSaving] = useState(false);

	const save = useCallback(async () => {
		if (optionsError) {
			setPreviewError(`Fix options JSON: ${optionsError}`);
			return;
		}
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
			setPreviewError("Invalid id — use letters, digits, _ or -");
			return;
		}
		if (!name.trim()) {
			setPreviewError("Name required");
			return;
		}

		// Validate SQL against the server before persisting. EXPLAIN is
		// cheaper than a real run and catches typos, missing columns, and
		// blocked statements without committing a broken widget that would
		// then 4xx on every dashboard refresh.
		setSaving(true);
		try {
			const resolved = substituteVars(sqlText, previewVars, {
				variables: props.variables,
				lenient: true,
			});
			try {
				await apiPost<QueryResult>("/query", { sql: `EXPLAIN ${resolved}` });
			} catch (err) {
				setPreviewError(
					`SQL validation failed: ${err instanceof Error ? err.message : "unknown error"}`,
				);
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
				timeRange,
				dashboardId: props.dashboardId,
				builtin: false,
			});
		} finally {
			setSaving(false);
		}
	}, [id, name, description, kind, sqlText, options, optionsError, timeRange, props]);

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
								disabled={!!props.initial?.id}
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
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Time range</span>
							<select
								value={timeRange ?? ""}
								onChange={(e) => setTimeRange(e.target.value || undefined)}
								className="rounded-md border border-border bg-background px-2 py-1"
							>
								<option value="">Inherit (dashboard default)</option>
								<option value="1h">1h</option>
								<option value="6h">6h</option>
								<option value="24h">24h</option>
								<option value="7d">7d</option>
								<option value="30d">30d</option>
							</select>
						</label>
						<div className="flex flex-col gap-1">
							<span className="text-muted-foreground">SQL</span>
							<div
								ref={editorHost}
								className="min-h-[220px] overflow-hidden rounded-md border border-border"
							/>
							<span className="text-[10px] text-muted-foreground">
								Vars:{" "}
								{["from", "to", ...props.variables.map((v) => v.name)]
									.map((n) => `\${${n}}`)
									.join(" ")}
							</span>
							{undeclared.length > 0 && (
								<span className="text-[10px] text-amber-600 dark:text-amber-500">
									Not declared on this dashboard: {undeclared.map((n) => `\${${n}}`).join(" ")} —
									these resolve to NULL. Add them as dashboard variables to filter by them.
								</span>
							)}
						</div>
						<label className="flex flex-col gap-1">
							<span className="text-muted-foreground">Options (JSON)</span>
							<textarea
								value={optionsDraft}
								onChange={(e) => {
									const v = e.target.value;
									setOptionsDraft(v);
									try {
										setOptions(JSON.parse(v));
										setOptionsError(null);
									} catch (err) {
										setOptionsError(err instanceof Error ? err.message : "Invalid JSON");
									}
								}}
								rows={6}
								className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
							/>
							{optionsError && <span className="text-[10px] text-destructive">{optionsError}</span>}
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
								disabled={saving}
								className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
							>
								{saving ? "Validating…" : "Save"}
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
