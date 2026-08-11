import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import {
	Area,
	AreaChart,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	ReferenceArea,
} from "recharts";
import { apiPost } from "@/api/client";
import { levelColor } from "@/lib/log-filters";

export interface TimelineBucket {
	time: number;
	label: string;
	info: number;
	warn: number;
	error: number;
	debug: number;
	trace: number;
	fatal: number;
	total: number;
}

/**
 * Both modes stack. Six independent lines on a shared axis meant `info` in the
 * thousands squashed `error` in the single digits flat onto the baseline — the
 * one series anybody opens a log viewer to find.
 */
export type ChartType = "area" | "bar";

export function normalizeChartType(value: string | null): ChartType {
	return value === "bar" ? "bar" : "area";
}

interface TimelineStripProps {
	from?: string;
	to?: string;
	filters?: Record<string, string | undefined>;
	refreshKey?: number;
	buckets?: number;
	height?: number;
	bare?: boolean;
	chartType?: ChartType;
	normalized?: boolean;
	onTimeRangeSelect?: (from: string, to: string) => void;
	onHoverBucket?: (bucket: TimelineBucket | null) => void;
}

/**
 * Stacking order, most severe on top so a spike in `fatal` sits against the
 * chart's own edge rather than riding on a moving baseline of `info`.
 */
export const LEVELS_ORDER = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

/** Kept as a named export so callers don't reach past this module for colours. */
export { levelColor };

/** Bottom margin leaves room for the axis labels; the rest bleeds to the edge. */
const CHART_MARGIN = { top: 4, right: 0, bottom: 0, left: 0 };

/** Filter keys `POST /histogram` accepts. */
const HISTOGRAM_FILTER_KEYS = [
	"level",
	"service",
	"project",
	"branch",
	"version",
	"deployment_id",
	"trace_id",
	"span_id",
	"grep",
] as const;

function parseRelativeTime(rel: string): number {
	const match = rel.match(/^(\d+)([smhdwMy])$/);
	if (!match) return Date.now() - 3600_000;
	const [, num, unit] = match;
	const ms: Record<string, number> = {
		s: 1000,
		m: 60_000,
		h: 3600_000,
		d: 86400_000,
		w: 604_800_000,
		M: 2_592_000_000,
		y: 31_536_000_000,
	};
	return Date.now() - parseInt(num!, 10) * (ms[unit!] ?? 3600_000);
}

function formatTimeLabel(ts: number, rangeMs: number): string {
	const d = new Date(ts);
	if (rangeMs > 86400_000 * 2) {
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	}
	return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

interface HistogramResponse {
	buckets: {
		time: number;
		fatal: number;
		error: number;
		warn: number;
		info: number;
		debug: number;
		trace: number;
		total: number;
	}[];
	bucket_ms: number;
}

export function TimelineStrip({
	from,
	to,
	filters,
	refreshKey,
	buckets,
	height = 120,
	bare = false,
	chartType = "area",
	normalized = false,
	onTimeRangeSelect,
	onHoverBucket,
}: TimelineStripProps) {
	const [data, setData] = useState<TimelineBucket[]>([]);
	const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
	const [dragEndIndex, setDragEndIndex] = useState<number | null>(null);
	const [hoverTime, setHoverTime] = useState<number | null>(null);
	const isDragging = useRef(false);

	const timeRange = useMemo(() => {
		const now = Date.now();
		// `new Date(badInput).getTime()` returns NaN, which silently
		// propagates into every bucket calculation and blanks the strip.
		// Coerce invalid inputs back to the 1h-default so the UI degrades
		// gracefully rather than vanishing.
		const parsed = (raw: string, fallback: number): number => {
			if (raw.match(/^\d+[smhdwMy]$/)) return parseRelativeTime(raw);
			const t = new Date(raw).getTime();
			return Number.isFinite(t) ? t : fallback;
		};
		const startMs = from ? parsed(from, now - 3600_000) : now - 3600_000;
		const endMs = to ? parsed(to, now) : now;
		return { startMs, endMs, rangeMs: endMs - startMs };
	}, [from, to]);

	useEffect(() => {
		const { startMs, endMs, rangeMs } = timeRange;

		// Every dimension the histogram endpoint understands. Forwarding only
		// four of them meant filtering by deployment or text left the chart
		// describing a different result set than the table below it.
		const histoFilters: Record<string, string> = {};
		for (const key of HISTOGRAM_FILTER_KEYS) {
			const value = filters?.[key];
			if (value) histoFilters[key] = value;
		}

		const body: Record<string, unknown> = {
			from: startMs,
			to: endMs,
			filters: Object.keys(histoFilters).length > 0 ? histoFilters : undefined,
		};
		if (buckets != null) body.buckets = buckets;

		apiPost<HistogramResponse>("/histogram", body)
			.then((res) => {
				const result: TimelineBucket[] = res.buckets.map((b) => ({
					...b,
					label: formatTimeLabel(b.time, rangeMs),
				}));
				setData(result);
			})
			.catch(() => {});
	}, [timeRange, filters, refreshKey, buckets]);

	const chartData = data;

	const handleMouseDown = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(state: any) => {
			if (!onTimeRangeSelect || state?.activeTooltipIndex == null) return;
			isDragging.current = true;
			setDragStartIndex(Number(state.activeTooltipIndex));
			setDragEndIndex(null);
		},
		[onTimeRangeSelect],
	);

	const handleMouseMove = useCallback(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(state: any) => {
			if (state?.activeTooltipIndex != null) {
				const idx = Number(state.activeTooltipIndex);
				const bucket = data[idx] ?? null;
				onHoverBucket?.(bucket);
				setHoverTime(bucket?.time ?? null);
			}
			if (!isDragging.current || state?.activeTooltipIndex == null) return;
			setDragEndIndex(Number(state.activeTooltipIndex));
		},
		[data, onHoverBucket],
	);

	const handleMouseLeave = useCallback(() => {
		onHoverBucket?.(null);
		setHoverTime(null);
	}, [onHoverBucket]);

	const handleMouseUp = useCallback(() => {
		if (
			!isDragging.current ||
			dragStartIndex === null ||
			dragEndIndex === null ||
			!onTimeRangeSelect
		) {
			isDragging.current = false;
			setDragStartIndex(null);
			setDragEndIndex(null);
			return;
		}
		isDragging.current = false;

		const startIdx = Math.min(dragStartIndex, dragEndIndex);
		const endIdx = Math.max(dragStartIndex, dragEndIndex);

		if (startIdx === endIdx) {
			setDragStartIndex(null);
			setDragEndIndex(null);
			return;
		}

		const startBucket = data[startIdx];
		const endBucket = data[endIdx];
		if (!startBucket || !endBucket) {
			setDragStartIndex(null);
			setDragEndIndex(null);
			return;
		}

		const bucketHalfWidth = data.length > 1 ? (data[1].time - data[0].time) / 2 : 0;
		const fromIso = new Date(startBucket.time - bucketHalfWidth).toISOString();
		const toIso = new Date(endBucket.time + bucketHalfWidth).toISOString();
		onTimeRangeSelect(fromIso, toIso);

		setDragStartIndex(null);
		setDragEndIndex(null);
	}, [dragStartIndex, dragEndIndex, onTimeRangeSelect, data]);

	const refAreaX1 =
		dragStartIndex !== null && dragEndIndex !== null
			? chartData[Math.min(dragStartIndex, dragEndIndex)]?.time
			: undefined;
	const refAreaX2 =
		dragStartIndex !== null && dragEndIndex !== null
			? chartData[Math.max(dragStartIndex, dragEndIndex)]?.time
			: undefined;

	const wrapperClass = bare ? "" : "shrink-0 border-b border-border px-4 pb-1 pt-2";

	// An empty result used to unmount the whole strip, so the toolbar and the
	// rows below jumped up 120px and back as you paged through ranges. Hold the
	// frame and say why it's blank instead. All-zero buckets count as empty:
	// the endpoint returns a full set of them, which otherwise drew as a
	// flatline that reads like a rendering failure.
	if (data.every((bucket) => bucket.total === 0)) {
		return (
			<div className={wrapperClass}>
				<div
					style={{ height }}
					className="flex items-center justify-center rounded-md border border-dashed border-border/70 text-2xs text-muted-foreground"
				>
					No activity in this range
				</div>
			</div>
		);
	}

	const xAxisProps = {
		dataKey: "time" as const,
		type: "number" as const,
		domain: ["dataMin", "dataMax"] as [string, string],
		tickFormatter: (ts: number) => formatTimeLabel(ts, timeRange.rangeMs),
		tick: { fontSize: 10, fill: "var(--color-muted-foreground)" },
		axisLine: false,
		tickLine: false,
		interval: "preserveStartEnd" as const,
		minTickGap: 60,
	};

	const grid = (
		<CartesianGrid vertical={false} stroke="var(--color-grid-line)" strokeDasharray="2 4" />
	);

	// Marks the bucket the toolbar's hover readout is describing — without it
	// the numbers change but nothing says which column they belong to.
	const cursor =
		hoverTime != null ? (
			<ReferenceLine x={hoverTime} stroke="var(--color-foreground)" strokeOpacity={0.25} />
		) : null;

	const mouseHandlers = {
		onMouseDown: onTimeRangeSelect ? handleMouseDown : undefined,
		onMouseMove: handleMouseMove,
		onMouseUp: onTimeRangeSelect ? handleMouseUp : undefined,
		onMouseLeave: handleMouseLeave,
	};

	const refArea =
		refAreaX1 != null && refAreaX2 != null ? (
			<ReferenceArea
				x1={refAreaX1}
				x2={refAreaX2}
				fill="var(--color-primary)"
				fillOpacity={0.15}
				stroke="var(--color-primary)"
				strokeOpacity={0.4}
			/>
		) : null;

	return (
		<div className={wrapperClass}>
			<div
				style={{
					height,
					...(onTimeRangeSelect ? { cursor: "crosshair", userSelect: "none" } : {}),
				}}
			>
				<ResponsiveContainer width="100%" height="100%">
					{chartType === "bar" ? (
						<BarChart
							data={chartData}
							stackOffset={normalized ? "expand" : undefined}
							margin={CHART_MARGIN}
							{...mouseHandlers}
						>
							{grid}
							<XAxis {...xAxisProps} />
							<YAxis hide />
							{refArea}
							{cursor}
							{LEVELS_ORDER.map((level) => (
								<Bar
									key={level}
									dataKey={level}
									stackId="level"
									fill={levelColor(level)}
									fillOpacity={0.85}
									isAnimationActive={false}
								/>
							))}
						</BarChart>
					) : (
						<AreaChart
							data={chartData}
							stackOffset={normalized ? "expand" : undefined}
							margin={CHART_MARGIN}
							{...mouseHandlers}
						>
							<defs>
								{LEVELS_ORDER.map((level) => (
									<linearGradient
										key={level}
										id={`level-fill-${level}`}
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop offset="0%" stopColor={levelColor(level)} stopOpacity={0.55} />
										<stop offset="100%" stopColor={levelColor(level)} stopOpacity={0.15} />
									</linearGradient>
								))}
							</defs>
							{grid}
							<XAxis {...xAxisProps} />
							<YAxis hide />
							{refArea}
							{cursor}
							{LEVELS_ORDER.map((level) => (
								<Area
									key={level}
									type="monotone"
									dataKey={level}
									stackId="level"
									stroke={levelColor(level)}
									strokeWidth={1.5}
									fill={`url(#level-fill-${level})`}
									isAnimationActive={false}
								/>
							))}
						</AreaChart>
					)}
				</ResponsiveContainer>
			</div>
		</div>
	);
}
