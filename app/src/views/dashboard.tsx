import { useCallback, useEffect, useRef, useState } from "react";
import { useHealth } from "@/hooks/use-health";
import { StatCard } from "@/components/stat-card";
import { LevelBadge } from "@/components/level-badge";
import { TimelineStrip } from "@/components/timeline-strip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiPost } from "@/api/client";
import type { LogLevel, QueryResult } from "@/types";
import { Loader2, RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const TIME_RANGES = [
	{ label: "1h", ms: 3600_000 },
	{ label: "6h", ms: 6 * 3600_000 },
	{ label: "24h", ms: 24 * 3600_000 },
	{ label: "7d", ms: 7 * 86400_000 },
	{ label: "30d", ms: 30 * 86400_000 },
];

const REFRESH_OPTIONS = [
	{ label: "Off", ms: 0 },
	{ label: "10s", ms: 10_000 },
	{ label: "30s", ms: 30_000 },
	{ label: "60s", ms: 60_000 },
];

const LEVEL_BAR_COLORS: Record<string, string> = {
	trace: "#a1a1aa",
	debug: "#60a5fa",
	info: "#34d399",
	warn: "#fbbf24",
	error: "#f87171",
	fatal: "#e879f9",
};

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

interface LevelCount {
	level: string;
	count: number;
}
interface ServiceCount {
	service: string;
	count: number;
}
interface RecentError {
	id: number;
	timestamp: string;
	level: LogLevel;
	message: string;
	service?: string;
}

export function DashboardView({
	enabled,
	onZoom,
}: {
	enabled: boolean;
	onZoom?: (from: string, to: string) => void;
}) {
	const [timeRange, setTimeRange] = useState(TIME_RANGES[2]); // 24h
	const [refreshMs, setRefreshMs] = useState(0);
	const [showRefreshMenu, setShowRefreshMenu] = useState(false);
	const [chartRefreshKey, setChartRefreshKey] = useState(0);
	const [levelCounts, setLevelCounts] = useState<LevelCount[]>([]);
	const [serviceCounts, setServiceCounts] = useState<ServiceCount[]>([]);
	const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
	const [loadingCharts, setLoadingCharts] = useState(false);
	const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

	const { data: health, error: healthError } = useHealth(enabled, 15_000);

	const fetchCharts = useCallback(async () => {
		const since = Date.now() - timeRange.ms;
		setLoadingCharts(true);

		try {
			const [levelRes, serviceRes, errorRes] = await Promise.all([
				apiPost<QueryResult>("/query", {
					sql: `SELECT level, COUNT(*) as count FROM logs WHERE created_at > ${since} GROUP BY level ORDER BY count DESC`,
				}),
				apiPost<QueryResult>("/query", {
					sql: `SELECT service, COUNT(*) as count FROM logs WHERE created_at > ${since} AND service IS NOT NULL GROUP BY service ORDER BY count DESC LIMIT 10`,
				}),
				apiPost<QueryResult>("/query", {
					sql: `SELECT id, timestamp, level, message, service FROM logs WHERE level IN ('error', 'fatal') ORDER BY created_at DESC LIMIT 10`,
				}),
			]);

			setChartRefreshKey((k) => k + 1);

			// Levels
			setLevelCounts(
				levelRes.rows.map((r) => ({ level: r.level as string, count: Number(r.count) })),
			);

			// Services
			setServiceCounts(
				serviceRes.rows.map((r) => ({ service: r.service as string, count: Number(r.count) })),
			);

			// Errors
			setRecentErrors(errorRes.rows as unknown as RecentError[]);
		} catch {
			// silent
		} finally {
			setLoadingCharts(false);
		}
	}, [timeRange]);

	useEffect(() => {
		if (!enabled) return;
		fetchCharts();
	}, [enabled, fetchCharts]);

	// Auto-refresh
	useEffect(() => {
		clearInterval(refreshTimerRef.current);
		if (refreshMs > 0) {
			refreshTimerRef.current = setInterval(fetchCharts, refreshMs);
		}
		return () => clearInterval(refreshTimerRef.current);
	}, [refreshMs, fetchCharts]);

	if (healthError) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-destructive">
				{healthError}
			</div>
		);
	}

	if (!health) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto p-4 space-y-4">
			{/* Time range + auto-refresh */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
					{TIME_RANGES.map((tr) => (
						<button
							key={tr.label}
							type="button"
							onClick={() => setTimeRange(tr)}
							className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
								timeRange.label === tr.label
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							{tr.label}
						</button>
					))}
				</div>
				<div className="flex-1" />
				{loadingCharts && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
				<button
					type="button"
					onClick={fetchCharts}
					className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
				<div className="relative">
					<button
						type="button"
						onClick={() => setShowRefreshMenu(!showRefreshMenu)}
						className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						Auto: {REFRESH_OPTIONS.find((o) => o.ms === refreshMs)?.label || "Off"}
					</button>
					{showRefreshMenu && (
						<div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
							{REFRESH_OPTIONS.map((o) => (
								<button
									key={o.label}
									type="button"
									onClick={() => {
										setRefreshMs(o.ms);
										setShowRefreshMenu(false);
									}}
									className={`block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-muted ${refreshMs === o.ms ? "text-foreground font-medium" : "text-popover-foreground"}`}
								>
									{o.label}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Stat cards */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard label="Status" value={health.ok ? "Online" : "Degraded"} />
				<StatCard label="Total Logs" value={health.log_count.toLocaleString()} />
				<StatCard
					label="Database Size"
					value={formatBytes(health.db_size_bytes)}
					detail={
						health.auto_prune?.db_usage_pct !== undefined
							? `${Math.round(health.auto_prune.db_usage_pct)}% of limit`
							: undefined
					}
				/>
				<StatCard label="Uptime" value={formatUptime(health.uptime)} />
			</div>

			{/* Log Volume chart */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Log Volume</CardTitle>
				</CardHeader>
				<CardContent>
					<TimelineStrip
						from={timeRange.label}
						buckets={40}
						height={192}
						bare
						refreshKey={chartRefreshKey}
						onTimeRangeSelect={onZoom}
					/>
				</CardContent>
			</Card>

			{/* Side by side: By Level + By Service */}
			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="text-sm">By Level</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="h-48">
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={levelCounts}
									layout="vertical"
									margin={{ top: 0, right: 0, bottom: 0, left: 50 }}
								>
									<XAxis type="number" hide />
									<YAxis
										type="category"
										dataKey="level"
										tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
										axisLine={false}
										tickLine={false}
										width={45}
									/>
									<Tooltip
										contentStyle={{
											fontSize: 11,
											background: "var(--color-popover)",
											border: "1px solid var(--color-border)",
											borderRadius: 6,
										}}
									/>
									<Bar dataKey="count" radius={[0, 4, 4, 0]}>
										{levelCounts.map((entry) => (
											<Cell
												key={entry.level}
												fill={LEVEL_BAR_COLORS[entry.level] || "#888"}
												fillOpacity={0.8}
											/>
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-sm">By Service</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="h-48">
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={serviceCounts}
									layout="vertical"
									margin={{ top: 0, right: 0, bottom: 0, left: 60 }}
								>
									<XAxis type="number" hide />
									<YAxis
										type="category"
										dataKey="service"
										tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
										axisLine={false}
										tickLine={false}
										width={55}
									/>
									<Tooltip
										contentStyle={{
											fontSize: 11,
											background: "var(--color-popover)",
											border: "1px solid var(--color-border)",
											borderRadius: 6,
										}}
									/>
									<Bar
										dataKey="count"
										fill="var(--color-primary)"
										fillOpacity={0.6}
										radius={[0, 4, 4, 0]}
									/>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Recent Errors */}
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Recent Errors</CardTitle>
				</CardHeader>
				<CardContent>
					{recentErrors.length === 0 ? (
						<span className="text-xs text-muted-foreground italic">No recent errors</span>
					) : (
						<div className="divide-y divide-border/50">
							{recentErrors.map((err) => (
								<div key={err.id} className="flex items-center gap-3 py-1.5 font-mono text-xs">
									<span className="shrink-0 text-muted-foreground tabular-nums">
										{new Date(err.timestamp).toLocaleTimeString("en-US", { hour12: false })}
									</span>
									<LevelBadge level={err.level} />
									{err.service && (
										<span className="shrink-0 text-muted-foreground">{err.service}</span>
									)}
									<span className="min-w-0 flex-1 truncate">{err.message}</span>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
