import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import {
	LineChart,
	Line,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	ResponsiveContainer,
	ReferenceArea,
} from "recharts";
import { apiPost } from "@/api/client";

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

export type ChartType = "line" | "bar";

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

export const LEVEL_COLORS: Record<string, string> = {
	fatal: "oklch(0.75 0.20 340)",
	error: "oklch(0.72 0.20 25)",
	warn: "oklch(0.85 0.16 85)",
	info: "oklch(0.80 0.15 170)",
	debug: "oklch(0.75 0.14 260)",
	trace: "oklch(0.70 0.06 270)",
};

export const LEVELS_ORDER = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

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
	chartType = "line",
	normalized = false,
	onTimeRangeSelect,
	onHoverBucket,
}: TimelineStripProps) {
	const [data, setData] = useState<TimelineBucket[]>([]);
	const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
	const [dragEndIndex, setDragEndIndex] = useState<number | null>(null);
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

		const histoFilters: Record<string, string> = {};
		if (filters?.level) histoFilters.level = filters.level;
		if (filters?.service) histoFilters.service = filters.service;
		if (filters?.project) histoFilters.project = filters.project;
		if (filters?.branch) histoFilters.branch = filters.branch;

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
				onHoverBucket?.(data[idx] ?? null);
			}
			if (!isDragging.current || state?.activeTooltipIndex == null) return;
			setDragEndIndex(Number(state.activeTooltipIndex));
		},
		[data, onHoverBucket],
	);

	const handleMouseLeave = useCallback(() => {
		onHoverBucket?.(null);
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

	if (data.length === 0) return null;

	const wrapperClass = bare ? "" : "shrink-0 border-b border-border px-4 py-2";

	const xAxisProps = {
		dataKey: "time" as const,
		type: "number" as const,
		domain: ["dataMin", "dataMax"] as [string, string],
		tickFormatter: (ts: number) => formatTimeLabel(ts, timeRange.rangeMs),
		tick: { fontSize: 9, fill: "var(--color-muted-foreground)" },
		axisLine: false,
		tickLine: false,
		interval: "preserveStartEnd" as const,
		minTickGap: 60,
	};

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
							margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
							{...mouseHandlers}
						>
							<CartesianGrid
								vertical={false}
								strokeDasharray="3 3"
								stroke="var(--color-border)"
								strokeOpacity={0.4}
							/>
							<XAxis {...xAxisProps} />
							<YAxis hide />
							{refArea}
							<Bar
								dataKey="fatal"
								stackId="1"
								fill={LEVEL_COLORS.fatal}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.fatal}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
							<Bar
								dataKey="error"
								stackId="1"
								fill={LEVEL_COLORS.error}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.error}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
							<Bar
								dataKey="warn"
								stackId="1"
								fill={LEVEL_COLORS.warn}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.warn}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
							<Bar
								dataKey="info"
								stackId="1"
								fill={LEVEL_COLORS.info}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.info}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
							<Bar
								dataKey="debug"
								stackId="1"
								fill={LEVEL_COLORS.debug}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.debug}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
							<Bar
								dataKey="trace"
								stackId="1"
								fill={LEVEL_COLORS.trace}
								fillOpacity={0.55}
								stroke={LEVEL_COLORS.trace}
								strokeOpacity={0.5}
								strokeWidth={1}
							/>
						</BarChart>
					) : (
						<LineChart
							data={chartData}
							margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
							{...mouseHandlers}
						>
							<CartesianGrid
								vertical={false}
								strokeDasharray="3 3"
								stroke="var(--color-border)"
								strokeOpacity={0.4}
							/>
							<XAxis {...xAxisProps} />
							<YAxis hide />
							{refArea}
							<Line
								type="monotone"
								dataKey="fatal"
								stroke={LEVEL_COLORS.fatal}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
							<Line
								type="monotone"
								dataKey="error"
								stroke={LEVEL_COLORS.error}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
							<Line
								type="monotone"
								dataKey="warn"
								stroke={LEVEL_COLORS.warn}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
							<Line
								type="monotone"
								dataKey="info"
								stroke={LEVEL_COLORS.info}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
							<Line
								type="monotone"
								dataKey="debug"
								stroke={LEVEL_COLORS.debug}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
							<Line
								type="monotone"
								dataKey="trace"
								stroke={LEVEL_COLORS.trace}
								strokeWidth={2.5}
								strokeOpacity={0.85}
								dot={false}
								fill="none"
							/>
						</LineChart>
					)}
				</ResponsiveContainer>
			</div>
		</div>
	);
}
