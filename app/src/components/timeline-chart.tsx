import { useState, useCallback, type ReactNode } from "react";
import { TimelineStrip, LEVEL_COLORS, LEVELS_ORDER } from "@/components/timeline-strip";
import type { ChartType, TimelineBucket } from "@/components/timeline-strip";
import { BarChart3, Percent, RotateCcw, TrendingUp } from "lucide-react";

export type { TimelineBucket } from "@/components/timeline-strip";

export function HoverStats({ bucket }: { bucket: TimelineBucket | null }) {
	if (!bucket) return null;
	return (
		<div className="flex items-center gap-2.5 text-[10px]">
			<div className="h-3 w-px bg-border" />
			<span className="tabular-nums text-muted-foreground">
				{new Date(bucket.time).toLocaleTimeString("en-US", { hour12: false })}
			</span>
			{LEVELS_ORDER.map((level) => {
				const count = bucket[level];
				if (count === 0) return null;
				return (
					<div key={level} className="flex items-center gap-1">
						<span
							className="inline-block h-1.5 w-1.5 rounded-sm"
							style={{ backgroundColor: LEVEL_COLORS[level] }}
						/>
						<span className="uppercase text-muted-foreground">{level}</span>
						<span className="tabular-nums text-foreground">{count.toLocaleString()}</span>
					</div>
				);
			})}
			<span className="tabular-nums font-medium text-foreground">
				{bucket.total.toLocaleString()}
			</span>
		</div>
	);
}

interface TimelineChartProps {
	from?: string;
	to?: string;
	filters?: Record<string, string | undefined>;
	refreshKey?: number;
	buckets?: number;
	height?: number;
	onTimeRangeSelect?: (from: string, to: string) => void;
	onResetTimeRange?: () => void;
	children?: ReactNode | ((hoverBucket: TimelineBucket | null) => ReactNode);
}

export function TimelineChart({
	from,
	to,
	filters,
	refreshKey,
	buckets,
	height,
	onTimeRangeSelect,
	onResetTimeRange,
	children,
}: TimelineChartProps) {
	const [chartType, setChartType] = useState<ChartType>(
		() => (localStorage.getItem("relog:chartType") as ChartType) || "line",
	);
	const [normalized, setNormalized] = useState(
		() => localStorage.getItem("relog:normalized") === "true",
	);
	const [hoverBucket, setHoverBucket] = useState<TimelineBucket | null>(null);

	const toggleChartType = useCallback(() => {
		setChartType((prev) => {
			const next = prev === "line" ? "bar" : "line";
			localStorage.setItem("relog:chartType", next);
			return next;
		});
	}, []);

	const toggleNormalized = useCallback(() => {
		setNormalized((prev) => {
			const next = !prev;
			localStorage.setItem("relog:normalized", String(next));
			return next;
		});
	}, []);

	const showReset = onResetTimeRange && from && !from.match(/^\d+[smhdwMy]$/);

	return (
		<>
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
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
				<div className="flex items-center rounded-md border border-border">
					<button
						type="button"
						onClick={chartType !== "line" ? toggleChartType : undefined}
						className={`flex items-center gap-1 rounded-l-md px-1.5 py-0.5 text-[10px] transition-colors ${
							chartType === "line"
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						title="Line chart"
					>
						<TrendingUp className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={chartType !== "bar" ? toggleChartType : undefined}
						className={`flex items-center gap-1 rounded-r-md px-1.5 py-0.5 text-[10px] transition-colors ${
							chartType === "bar"
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						title="Bar chart"
					>
						<BarChart3 className="h-3 w-3" />
					</button>
				</div>

				<button
					type="button"
					onClick={toggleNormalized}
					className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
						normalized
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:bg-muted hover:text-foreground"
					}`}
					title="Normalize to 100%"
				>
					<Percent className="h-3 w-3" />
				</button>

				{showReset && (
					<button
						type="button"
						onClick={onResetTimeRange}
						className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						title="Reset time range"
					>
						<RotateCcw className="h-3 w-3" />
						Reset
					</button>
				)}

				{typeof children === "function" ? children(hoverBucket) : children}
			</div>
		</>
	);
}
