import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { sql, SQLite } from "@codemirror/lang-sql";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { oneDark } from "@codemirror/theme-one-dark";
import { X } from "lucide-react";
import { apiPost } from "@/api/client";
import type { QueryResult, Widget, WidgetKind, WidgetOptions } from "@/types";
import { WidgetRenderer } from "./widget-renderer";
import { substituteVars } from "./sql-vars";

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
								Vars: $&#123;from&#125; $&#123;to&#125; $&#123;service&#125; $&#123;project&#125;
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
