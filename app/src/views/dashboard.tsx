import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, EyeOff, Loader2, Pencil, Trash2 } from "lucide-react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useHealth } from "@/hooks/use-health";
import { useWidgetData } from "@/hooks/use-widget-data";
import { useWidgets } from "@/hooks/use-widgets";
import { FilterBar, TIME_RANGES } from "@/components/dashboard/filter-bar";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { WidgetEditor } from "@/components/dashboard/widget-editor";
import type { Widget } from "@/types";

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
	const [editor, setEditor] = useState<
		{ open: true; widget?: Widget } | { open: false }
	>({ open: false });
	const gridContainerRef = useRef<HTMLDivElement | null>(null);
	const [gridWidth, setGridWidth] = useState(1200);

	const refreshMs = parseInt(refreshMsStr ?? "0", 10);
	const timeRange = TIME_RANGES.find((t) => t.label === timeRangeLabel) ?? TIME_RANGES[2];
	const now = Date.now();
	const filterFrom = now - timeRange.ms;
	const filterTo = now;

	const { data: health } = useHealth(enabled, 15_000);

	useEffect(() => {
		if (!gridContainerRef.current) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) setGridWidth(e.contentRect.width);
		});
		ro.observe(gridContainerRef.current);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		if (!refreshMs) return;
		const t = setInterval(() => setRefreshKey((k) => k + 1), refreshMs);
		return () => clearInterval(t);
	}, [refreshMs]);

	const visibleWidgets = useMemo(
		() => widgets.filter((w) => !hidden.has(w.id)),
		[widgets, hidden],
	);

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
		setEditor({
			open: true,
			widget: { ...w, id: "", builtin: false, createdAt: 0, updatedAt: 0 },
		});
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

	const canEdit = true;

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
						<span className="truncate text-[10px] text-muted-foreground">
							{widget.description}
						</span>
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
