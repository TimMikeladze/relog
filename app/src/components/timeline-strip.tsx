import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceArea } from "recharts";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

interface TimelineBucket {
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

interface TimelineStripProps {
	from?: string;
	to?: string;
	filters?: Record<string, string | undefined>;
	refreshKey?: number;
	buckets?: number;
	height?: number;
	bare?: boolean;
	onTimeRangeSelect?: (from: string, to: string) => void;
}

const LEVEL_COLORS: Record<string, string> = {
	fatal: "oklch(0.7 0.19 350)",
	error: "oklch(0.65 0.2 25)",
	warn: "oklch(0.8 0.15 85)",
	info: "oklch(0.7 0.15 160)",
	debug: "oklch(0.65 0.1 250)",
	trace: "oklch(0.6 0.02 0)",
};

function parseRelativeTime(rel: string): number {
	const match = rel.match(/^(\d+)([smhd])$/);
	if (!match) return Date.now() - 3600_000;
	const [, num, unit] = match;
	const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 };
	return Date.now() - parseInt(num) * (ms[unit] ?? 3600_000);
}

function formatTimeLabel(ts: number, rangeMs: number): string {
	const d = new Date(ts);
	if (rangeMs > 86400_000 * 2) {
		return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
	}
	return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

export function TimelineStrip({
	from,
	to,
	filters,
	refreshKey,
	buckets = 60,
	height = 64,
	bare = false,
	onTimeRangeSelect,
}: TimelineStripProps) {
	const [data, setData] = useState<TimelineBucket[]>([]);
	const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
	const [dragEndIndex, setDragEndIndex] = useState<number | null>(null);
	const [hoverIndex, setHoverIndex] = useState<number | null>(null);
	const isDragging = useRef(false);

	const timeRange = useMemo(() => {
		const now = Date.now();
		const startMs = from
			? from.match(/^\d+[smhd]$/)
				? parseRelativeTime(from)
				: new Date(from).getTime()
			: now - 3600_000;
		const endMs = to ? new Date(to).getTime() : now;
		return { startMs, endMs, rangeMs: endMs - startMs };
	}, [from, to]);

	useEffect(() => {
		const { startMs, endMs, rangeMs } = timeRange;
		const bucketMs = rangeMs / buckets;

		let whereClause = `WHERE created_at >= ${startMs} AND created_at <= ${endMs}`;
		if (filters?.level) whereClause += ` AND level = '${filters.level}'`;
		if (filters?.service) whereClause += ` AND service = '${filters.service}'`;
		if (filters?.project) whereClause += ` AND project = '${filters.project}'`;
		if (filters?.branch) whereClause += ` AND branch = '${filters.branch}'`;

		const sql = `
      SELECT
        CAST((created_at - ${startMs}) / ${Math.floor(bucketMs)} AS INTEGER) as bucket,
        level,
        COUNT(*) as count
      FROM logs
      ${whereClause}
      GROUP BY bucket, level
      ORDER BY bucket
    `;

		apiPost<QueryResult>("/query", { sql })
			.then((res) => {
				const bucketMap = new Map<number, TimelineBucket>();
				for (let i = 0; i < buckets; i++) {
					const time = startMs + i * bucketMs + bucketMs / 2;
					bucketMap.set(i, {
						time,
						label: formatTimeLabel(time, rangeMs),
						info: 0,
						warn: 0,
						error: 0,
						debug: 0,
						trace: 0,
						fatal: 0,
						total: 0,
					});
				}
				for (const row of res.rows) {
					const idx = Number(row.bucket);
					const bucket = bucketMap.get(idx);
					if (!bucket) continue;
					const level = row.level as string;
					const count = Number(row.count);
					if (level in bucket) {
						(bucket as unknown as Record<string, unknown>)[level] = count;
					}
					bucket.total += count;
				}
				setData(Array.from(bucketMap.values()));
			})
			.catch(() => {});
	}, [timeRange, filters, refreshKey, buckets]);

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
				setHoverIndex(Number(state.activeTooltipIndex));
			}
			if (!isDragging.current || state?.activeTooltipIndex == null) return;
			setDragEndIndex(Number(state.activeTooltipIndex));
		},
		[],
	);

	const handleMouseLeave = useCallback(() => {
		setHoverIndex(null);
	}, []);

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
			? data[Math.min(dragStartIndex, dragEndIndex)]?.time
			: undefined;
	const refAreaX2 =
		dragStartIndex !== null && dragEndIndex !== null
			? data[Math.max(dragStartIndex, dragEndIndex)]?.time
			: undefined;

	const hoverBucket = hoverIndex !== null ? data[hoverIndex] : null;
	const hoverLabel = hoverBucket
		? `${new Date(hoverBucket.time).toLocaleTimeString("en-US", { hour12: false })}  ·  ${hoverBucket.total.toLocaleString()} logs`
		: null;

	if (data.length === 0) return null;

	const wrapperClass = bare ? "" : "shrink-0 border-b border-border px-4 py-2";

	return (
		<div className={wrapperClass}>
			<div className="relative">
				{hoverLabel && (
					<span className="absolute right-0 top-0 z-10 text-[10px] text-muted-foreground tabular-nums pointer-events-none">
						{hoverLabel}
					</span>
				)}
			</div>
			<div
				style={{
					height,
					...(onTimeRangeSelect ? { cursor: "crosshair", userSelect: "none" } : {}),
				}}
			>
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart
						data={data}
						margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
						onMouseDown={onTimeRangeSelect ? handleMouseDown : undefined}
						onMouseMove={handleMouseMove}
						onMouseUp={onTimeRangeSelect ? handleMouseUp : undefined}
						onMouseLeave={handleMouseLeave}
					>
						<XAxis
							dataKey="time"
							type="number"
							domain={["dataMin", "dataMax"]}
							tickFormatter={(ts) => formatTimeLabel(ts, timeRange.rangeMs)}
							tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
							axisLine={false}
							tickLine={false}
							interval="preserveStartEnd"
							minTickGap={60}
						/>
						<YAxis hide />
						{refAreaX1 != null && refAreaX2 != null && (
							<ReferenceArea
								x1={refAreaX1}
								x2={refAreaX2}
								fill="var(--color-primary)"
								fillOpacity={0.15}
								stroke="var(--color-primary)"
								strokeOpacity={0.4}
							/>
						)}
						<Area
							type="monotone"
							dataKey="error"
							stackId="1"
							fill={LEVEL_COLORS.error}
							stroke="none"
							fillOpacity={0.85}
						/>
						<Area
							type="monotone"
							dataKey="fatal"
							stackId="1"
							fill={LEVEL_COLORS.fatal}
							stroke="none"
							fillOpacity={0.85}
						/>
						<Area
							type="monotone"
							dataKey="warn"
							stackId="1"
							fill={LEVEL_COLORS.warn}
							stroke="none"
							fillOpacity={0.6}
						/>
						<Area
							type="monotone"
							dataKey="info"
							stackId="1"
							fill={LEVEL_COLORS.info}
							stroke="none"
							fillOpacity={0.5}
						/>
						<Area
							type="monotone"
							dataKey="debug"
							stackId="1"
							fill={LEVEL_COLORS.debug}
							stroke="none"
							fillOpacity={0.3}
						/>
						<Area
							type="monotone"
							dataKey="trace"
							stackId="1"
							fill={LEVEL_COLORS.trace}
							stroke="none"
							fillOpacity={0.2}
						/>
					</AreaChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}
