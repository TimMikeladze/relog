import { useCallback, useState, type ReactNode } from "react";
import {
	LEVELS_ORDER,
	normalizeChartType,
	TimelineStrip,
	levelColor,
} from "@/components/timeline-strip";
import type { ChartType, TimelineBucket } from "@/components/timeline-strip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AreaChart, BarChart3, ChevronDown, RotateCcw, Settings2 } from "lucide-react";

export type { TimelineBucket } from "@/components/timeline-strip";

const GRANULARITIES = [
	{ label: "Auto", value: "" },
	{ label: "Fine — 60 buckets", value: "60" },
	{ label: "Normal — 45 buckets", value: "45" },
	{ label: "Coarse — 30 buckets", value: "30" },
	{ label: "Very coarse — 20 buckets", value: "20" },
	{ label: "Ultra coarse — 12 buckets", value: "12" },
];

/**
 * Per-level counts for the hovered bucket. Lives in the toolbar rather than a
 * floating tooltip so the numbers land in the same place every time and never
 * cover the chart you're reading them off.
 */
export function HoverStats({ bucket }: { bucket: TimelineBucket | null }) {
	if (!bucket) return null;
	return (
		<div className="flex min-w-0 items-center gap-2 overflow-hidden text-2xs">
			<div className="h-3 w-px shrink-0 bg-border" />
			<span className="shrink-0 tabular-nums text-muted-foreground">
				{new Date(bucket.time).toLocaleTimeString("en-US", { hour12: false })}
			</span>
			{LEVELS_ORDER.map((level) => {
				const count = bucket[level];
				if (count === 0) return null;
				return (
					<div key={level} className="flex shrink-0 items-center gap-1">
						<span
							className="inline-block size-1.5 rounded-full"
							style={{ backgroundColor: levelColor(level) }}
						/>
						<span className="tabular-nums">{count.toLocaleString()}</span>
					</div>
				);
			})}
			<span className="shrink-0 tabular-nums font-medium">{bucket.total.toLocaleString()}</span>
		</div>
	);
}

function ToggleGroupItem({
	active,
	onClick,
	title,
	children,
}: {
	active: boolean;
	onClick: () => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={active}
			className={cn(
				"flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-2xs",
				active
					? "bg-background text-foreground shadow-xs"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

interface TimelineChartProps {
	from?: string;
	to?: string;
	filters?: Record<string, string | undefined>;
	refreshKey?: number;
	buckets?: number;
	height?: number;
	onBucketsChange?: (buckets: number | undefined) => void;
	onTimeRangeSelect?: (from: string, to: string) => void;
	onResetTimeRange?: () => void;
	/** Left-hand toolbar slot: live state and result counts. */
	leading?: ReactNode;
	/** Right-hand toolbar slot: view actions like export and refresh. */
	trailing?: ReactNode;
}

export function TimelineChart({
	from,
	to,
	filters,
	refreshKey,
	buckets,
	height,
	onBucketsChange,
	onTimeRangeSelect,
	onResetTimeRange,
	leading,
	trailing,
}: TimelineChartProps) {
	const [chartType, setChartType] = useState<ChartType>(() =>
		normalizeChartType(localStorage.getItem("relog:chartType")),
	);
	const [normalized, setNormalized] = useState(
		() => localStorage.getItem("relog:normalized") === "true",
	);
	const [collapsed, setCollapsed] = useState(
		() => localStorage.getItem("relog:chartCollapsed") === "true",
	);
	const [hoverBucket, setHoverBucket] = useState<TimelineBucket | null>(null);

	const pickChartType = useCallback((next: ChartType) => {
		setChartType(next);
		localStorage.setItem("relog:chartType", next);
	}, []);

	const toggleNormalized = useCallback(() => {
		setNormalized((prev) => {
			localStorage.setItem("relog:normalized", String(!prev));
			return !prev;
		});
	}, []);

	const toggleCollapsed = useCallback(() => {
		setCollapsed((prev) => {
			localStorage.setItem("relog:chartCollapsed", String(!prev));
			return !prev;
		});
	}, []);

	// Only meaningful for an absolute range — a relative one is already the
	// "reset" state, so offering to reset it does nothing visible.
	const showReset = onResetTimeRange && from && !from.match(/^\d+[smhdwMy]$/);

	return (
		<>
			{!collapsed && (
				<TimelineStrip
					from={from}
					to={to}
					filters={filters}
					refreshKey={refreshKey}
					buckets={buckets}
					height={height}
					chartType={chartType}
					normalized={normalized}
					onTimeRangeSelect={onTimeRangeSelect}
					onHoverBucket={setHoverBucket}
				/>
			)}

			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2.5">
				<button
					type="button"
					onClick={toggleCollapsed}
					title={collapsed ? "Show timeline" : "Hide timeline"}
					aria-expanded={!collapsed}
					className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<ChevronDown className={cn("size-3", collapsed && "-rotate-90")} />
					Timeline
				</button>

				<div className="h-3 w-px shrink-0 bg-border" />

				{leading}

				{showReset && (
					<button
						type="button"
						onClick={onResetTimeRange}
						className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
						title="Reset to the full time range"
					>
						<RotateCcw className="size-3" />
						Reset zoom
					</button>
				)}

				<HoverStats bucket={hoverBucket} />

				<div className="min-w-0 flex-1" />

				{trailing}

				<Popover>
					<PopoverTrigger
						title="Chart display"
						aria-label="Chart display options"
						className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
					>
						<Settings2 className="size-3.5" />
					</PopoverTrigger>
					<PopoverContent align="end" sideOffset={6} className="w-56 gap-3 p-3">
						<div className="space-y-1.5">
							<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
								Shape
							</div>
							<div className="flex gap-0.5 rounded-md bg-muted p-0.5">
								<ToggleGroupItem
									active={chartType === "area"}
									onClick={() => pickChartType("area")}
									title="Stacked area"
								>
									<AreaChart className="size-3" />
									Area
								</ToggleGroupItem>
								<ToggleGroupItem
									active={chartType === "bar"}
									onClick={() => pickChartType("bar")}
									title="Stacked bars"
								>
									<BarChart3 className="size-3" />
									Bars
								</ToggleGroupItem>
							</div>
						</div>

						<label className="flex items-center justify-between gap-2">
							<span className="text-xs">Show as percentage</span>
							<input
								type="checkbox"
								checked={normalized}
								onChange={toggleNormalized}
								className="size-3.5 accent-primary"
							/>
						</label>

						<div className="space-y-1.5">
							<div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
								Granularity
							</div>
							<select
								value={buckets?.toString() ?? ""}
								onChange={(e) =>
									onBucketsChange?.(e.target.value ? Number(e.target.value) : undefined)
								}
								className="h-7 w-full rounded-md border border-border bg-transparent px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
							>
								{GRANULARITIES.map((g) => (
									<option key={g.value} value={g.value}>
										{g.label}
									</option>
								))}
							</select>
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</>
	);
}
