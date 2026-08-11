import { Loader2, Lock, Pencil, Plus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

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
	/**
	 * Dashboard-specific controls, rendered between the time range and the
	 * status readout. The bar itself knows nothing about what they filter —
	 * that is the dashboard's business, not the toolbar's.
	 */
	variableControls?: ReactNode;
	/** Dashboard picker, rendered leftmost. */
	leading?: ReactNode;
	refreshMs: number;
	onRefreshMs: (ms: number) => void;
	loading: boolean;
	onManualRefresh: () => void;
	editMode: boolean;
	onEditMode: (v: boolean) => void;
	onAddWidget: () => void;
	canEdit: boolean;
}

export function FilterBar(props: FilterBarProps) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			{props.leading}

			{/* Coarse fixed ranges suit a dashboard, so this stays a segmented
			    control rather than Explore's range picker — but it wears the same
			    inset-track treatment as every other segmented group in the app. */}
			<div className="flex h-7 items-center gap-0.5 rounded-md bg-muted p-0.5">
				{TIME_RANGES.map((tr) => (
					<button
						key={tr.label}
						type="button"
						aria-pressed={props.timeRange === tr.label}
						onClick={() => props.onTimeRange(tr.label)}
						className={`h-6 rounded-[5px] px-2.5 text-xs font-medium tabular-nums ${
							props.timeRange === tr.label
								? "bg-background text-foreground shadow-xs"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{tr.label}
					</button>
				))}
			</div>

			{props.variableControls}

			<div className="flex-1" />

			{props.loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}

			{/* Refresh is one concern: the manual trigger and its interval sit in
			    one group rather than reading as two unrelated controls. */}
			<div className="flex h-7 items-center rounded-md border border-border">
				<button
					type="button"
					onClick={props.onManualRefresh}
					className="flex h-full items-center rounded-l-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
					aria-label="Refresh now"
					title="Refresh now"
				>
					<RefreshCw className="size-3.5" />
				</button>
				<div className="h-4 w-px bg-border" />
				<select
					className="h-full rounded-r-md bg-transparent px-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
					value={props.refreshMs}
					onChange={(e) => props.onRefreshMs(Number(e.target.value))}
					aria-label="Auto-refresh interval"
				>
					{REFRESH_OPTIONS.map((o) => (
						<option key={o.label} value={o.ms}>
							Auto: {o.label}
						</option>
					))}
				</select>
			</div>

			{props.canEdit && (
				<>
					<button
						type="button"
						onClick={() => props.onEditMode(!props.editMode)}
						className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs ${
							props.editMode
								? "border-primary/40 bg-primary/10 text-foreground"
								: "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
						}`}
					>
						{props.editMode ? <Pencil className="size-3" /> : <Lock className="size-3" />}
						{props.editMode ? "Editing" : "Locked"}
					</button>
					{props.editMode && (
						<button
							type="button"
							onClick={props.onAddWidget}
							className="flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>
							<Plus className="size-3" /> Add widget
						</button>
					)}
				</>
			)}
		</div>
	);
}
