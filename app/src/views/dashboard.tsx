import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, EyeOff, Loader2, Pencil, Trash2 } from "lucide-react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useWidgetData } from "@/hooks/use-widget-data";
import { useCanEditWidgets, useWidgets } from "@/hooks/use-widgets";
import { DEFAULT_DASHBOARD_ID, useDashboards, useVariableOptions } from "@/hooks/use-dashboards";
import { FilterBar, TIME_RANGES } from "@/components/dashboard/filter-bar";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { WidgetEditor } from "@/components/dashboard/widget-editor";
import { DashboardPicker } from "@/components/dashboard/dashboard-picker";
import { DashboardEditor } from "@/components/dashboard/dashboard-editor";
import { VariableControls } from "@/components/dashboard/variable-controls";
import { defaultVarValues } from "@/components/dashboard/sql-vars";
import type { Dashboard, DashboardVariable, Widget } from "@/types";

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

const NO_VARIABLES: DashboardVariable[] = [];

// No `enabled` gate: the widget and dashboard hooks don't poll, and the only
// thing that did — a /health poll feeding a status readout the status bar
// already renders — is gone.
export function DashboardView() {
	const { widgets, loading: widgetsLoading, create, update, remove, refetch } = useWidgets();
	const {
		dashboards,
		loading: dashboardsLoading,
		create: createDashboard,
		update: updateDashboard,
		remove: removeDashboard,
	} = useDashboards();

	const [dashboardId, setDashboardId] = useHashParam("dashboard", DEFAULT_DASHBOARD_ID);
	const [timeRangeLabel, setTimeRangeLabel] = useHashParam("range", "");
	const [refreshMsStr, setRefreshMsStr] = useHashParam("refresh", "0");
	const [editMode, setEditMode] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const [hidden, setHidden] = useState<Set<string>>(() => readHidden());
	const [editor, setEditor] = useState<
		{ open: true; widget?: Widget; snapshot: { from: number; to: number } } | { open: false }
	>({ open: false });
	const [dashboardEditor, setDashboardEditor] = useState<
		{ open: true; dashboard?: Dashboard } | { open: false }
	>({ open: false });

	const activeId = dashboardId || DEFAULT_DASHBOARD_ID;
	const dashboard = useMemo(
		() => dashboards.find((d) => d.id === activeId),
		[dashboards, activeId],
	);
	const variables = dashboard?.variables ?? NO_VARIABLES;

	// An explicit range in the URL wins so a shared link keeps its range;
	// otherwise the dashboard's own default applies, which is what makes a
	// 7-day analytics dashboard and a 1-hour ops dashboard both feel right on
	// first open.
	const timeRange = useMemo(() => {
		const label = timeRangeLabel || dashboard?.defaultTimeRange || "24h";
		return TIME_RANGES.find((t) => t.label === label) ?? TIME_RANGES[2]!;
	}, [timeRangeLabel, dashboard?.defaultTimeRange]);

	// Variable values live per dashboard so switching back and forth doesn't
	// carry a `site` filter onto a dashboard that has no such variable.
	const [valuesByDashboard, setValuesByDashboard] = useState<
		Record<string, Record<string, string>>
	>({});
	const values = useMemo(
		() => valuesByDashboard[activeId] ?? defaultVarValues(variables),
		[valuesByDashboard, activeId, variables],
	);

	const setValue = useCallback(
		(name: string, value: string) => {
			setValuesByDashboard((prev) => ({
				...prev,
				[activeId]: { ...(prev[activeId] ?? defaultVarValues(variables)), [name]: value },
			}));
		},
		[activeId, variables],
	);

	const { options: variableOptions } = useVariableOptions(variables, refreshKey);

	const refreshMs = parseInt(refreshMsStr ?? "0", 10);
	const canEdit = useCanEditWidgets();

	useEffect(() => {
		if (!refreshMs) return;
		const t = setInterval(() => setRefreshKey((k) => k + 1), refreshMs);
		return () => clearInterval(t);
	}, [refreshMs]);

	// Widgets predating dashboards carry no dashboardId; they belong to the
	// default dashboard rather than disappearing.
	const dashboardWidgets = useMemo(
		() => widgets.filter((w) => (w.dashboardId ?? DEFAULT_DASHBOARD_ID) === activeId),
		[widgets, activeId],
	);

	const visibleWidgets = useMemo(
		() => dashboardWidgets.filter((w) => !hidden.has(w.id)),
		[dashboardWidgets, hidden],
	);

	const hiddenHere = useMemo(
		() => dashboardWidgets.filter((w) => hidden.has(w.id)).length,
		[dashboardWidgets, hidden],
	);

	const openEditor = useCallback(
		(widget?: Widget) => {
			const now = Date.now();
			setEditor({ open: true, widget, snapshot: { from: now - timeRange.ms, to: now } });
		},
		[timeRange.ms],
	);

	const handleLayoutChange = useCallback(
		(updates: { id: string; layout: Widget["layout"] }[], opts?: { keepalive?: boolean }) => {
			for (const { id, layout } of updates) {
				update(id, { layout }, opts).catch(() => {});
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

	const handleDuplicate = useCallback(
		(w: Widget) => {
			openEditor({ ...w, id: "", builtin: false, createdAt: 0, updatedAt: 0 });
		},
		[openEditor],
	);

	const handleDelete = useCallback(
		async (w: Widget) => {
			if (w.builtin) return;
			if (!confirm(`Delete widget "${w.name}"?`)) return;
			await remove(w.id);
		},
		[remove],
	);

	const handleDeleteDashboard = useCallback(
		async (d: Dashboard) => {
			if (!confirm(`Delete dashboard "${d.name}" and all of its widgets? This cannot be undone.`)) {
				return;
			}
			await removeDashboard(d.id);
			if (activeId === d.id) setDashboardId(DEFAULT_DASHBOARD_ID);
			await refetch();
		},
		[removeDashboard, activeId, setDashboardId, refetch],
	);

	const filters = useMemo(
		() => ({ timeRange: timeRange.label, values, variables }),
		[timeRange.label, values, variables],
	);

	if ((widgetsLoading || dashboardsLoading) && widgets.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
			<FilterBar
				leading={
					<DashboardPicker
						dashboards={dashboards}
						activeId={activeId}
						onSelect={(id) => {
							setDashboardId(id);
							// Range is per-dashboard; clearing lets the newly selected
							// dashboard's default take effect.
							setTimeRangeLabel("");
						}}
						onCreate={() => setDashboardEditor({ open: true })}
						onEdit={(d) => setDashboardEditor({ open: true, dashboard: d })}
						onDelete={handleDeleteDashboard}
						canEdit={canEdit}
					/>
				}
				variableControls={
					<VariableControls
						variables={variables}
						values={values}
						options={variableOptions}
						onChange={setValue}
					/>
				}
				timeRange={timeRange.label}
				onTimeRange={setTimeRangeLabel}
				refreshMs={refreshMs}
				onRefreshMs={(v) => setRefreshMsStr(String(v))}
				loading={widgetsLoading}
				onManualRefresh={() => {
					refetch();
					setRefreshKey((k) => k + 1);
				}}
				editMode={editMode}
				onEditMode={setEditMode}
				onAddWidget={() => openEditor()}
				canEdit={canEdit}
			/>

			{hiddenHere > 0 && (
				<div className="text-xs text-muted-foreground">
					{hiddenHere} hidden ·{" "}
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

			<div className="flex-1 overflow-auto">
				{visibleWidgets.length === 0 ? (
					<EmptyDashboard
						canEdit={canEdit}
						onAddWidget={() => {
							setEditMode(true);
							openEditor();
						}}
					/>
				) : (
					<WidgetGrid
						widgets={visibleWidgets}
						editMode={editMode}
						onLayoutChange={handleLayoutChange}
						renderWidget={(w) => (
							<WidgetTile
								widget={w}
								filters={filters}
								refreshKey={refreshKey}
								editMode={editMode}
								onEdit={() => openEditor(w)}
								onDuplicate={() => handleDuplicate(w)}
								onDelete={() => handleDelete(w)}
								onHide={() => toggleHidden(w.id)}
							/>
						)}
					/>
				)}
			</div>

			{editor.open && (
				<WidgetEditor
					initial={editor.widget}
					filterFrom={editor.snapshot.from}
					filterTo={editor.snapshot.to}
					dashboardId={activeId}
					variables={variables}
					values={values}
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

			{dashboardEditor.open && (
				<DashboardEditor
					initial={dashboardEditor.dashboard}
					onCancel={() => setDashboardEditor({ open: false })}
					onSave={async (d) => {
						if (dashboardEditor.dashboard) {
							await updateDashboard(d.id, d);
						} else {
							await createDashboard(d);
							setDashboardId(d.id);
							setTimeRangeLabel("");
						}
						setDashboardEditor({ open: false });
					}}
				/>
			)}
		</div>
	);
}

function EmptyDashboard({ canEdit, onAddWidget }: { canEdit: boolean; onAddWidget: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 text-center">
			<p className="text-sm font-medium">No widgets on this dashboard</p>
			<p className="max-w-md text-xs text-muted-foreground">
				Widgets are SQL queries rendered as charts. They can read this dashboard's variables as{" "}
				<code>{"${name}"}</code> placeholders.
			</p>
			{canEdit && (
				<button
					type="button"
					onClick={onAddWidget}
					className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
				>
					Add widget
				</button>
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
	filters: { timeRange: string; values: Record<string, string>; variables: DashboardVariable[] };
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
			<div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
				<div className="flex min-w-0 flex-col">
					<span className="truncate text-xs font-medium">{widget.name}</span>
					{widget.description && (
						<span className="truncate text-2xs text-muted-foreground">{widget.description}</span>
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
			<div className="widget-no-drag flex-1 overflow-hidden">
				<WidgetRenderer
					widget={widget}
					rows={data.rows}
					columns={data.columns}
					loading={data.loading}
					error={data.error}
					stale={data.stale}
					onReload={data.reload}
				/>
			</div>
		</div>
	);
}
