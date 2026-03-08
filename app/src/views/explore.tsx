import { useCallback, useEffect, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useLogs } from "@/hooks/use-logs";
import { useStream } from "@/hooks/use-stream";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { LogTable } from "@/components/log-table";
import { TimelineChart, HoverStats } from "@/components/timeline-chart";
import type { Filters } from "@/types";
import { Circle, Download, Loader2, Pause, Play, RefreshCw, Radio, Trash2, PanelRight, AlignLeft } from "lucide-react";

export function ExploreView({
	filters,
	enabled,
	onNavigateTrace,
	onUpdateFilters,
}: {
	filters: Filters;
	enabled: boolean;
	onNavigateTrace?: (traceId: string) => void;
	onUpdateFilters: (updates: Partial<Filters>) => void;
}) {
	const { isBookmarked } = useBookmarks();
	const [live, setLive] = useHashParam("live");
	const [detailMode, setDetailMode] = useHashParam("detail", "panel");
	const [showExport, setShowExport] = useState(false);
	const [bucketGranularity, setBucketGranularity] = useState<number | undefined>(undefined);

	const stream = useStream(filters, enabled && live === "1");
	const { rows, total, loading, loadingMore, error, hasMore, loadMore, refetch } = useLogs(
		filters,
		enabled,
	);

	const [refreshKey, setRefreshKey] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

	useEffect(() => {
		if (live !== "1") return;
		intervalRef.current = setInterval(() => setRefreshKey((k) => k + 1), 10_000);
		return () => clearInterval(intervalRef.current);
	}, [live]);

	const toggleLive = useCallback(() => {
		setLive(live === "1" ? undefined : "1");
	}, [live, setLive]);

	const handleTimeRangeSelect = useCallback(
		(from: string, to: string) => {
			onUpdateFilters({ from, to });
		},
		[onUpdateFilters],
	);

	const exportData = useCallback(
		(format: "json" | "csv") => {
			const exportRows = live === "1" ? stream.logs : rows;
			if (!exportRows?.length) return;
			let content: string;
			let ext: string;

			if (format === "csv") {
				const headers = [
					"id",
					"timestamp",
					"level",
					"message",
					"service",
					"project",
					"branch",
					"trace_id",
					"meta",
				];
				const csvRows = exportRows.map((r) =>
					headers
						.map((h) => {
							const val = r[h as keyof typeof r];
							if (val === null || val === undefined) return "";
							const str = typeof val === "object" ? JSON.stringify(val) : String(val);
							return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
						})
						.join(","),
				);
				content = [headers.join(","), ...csvRows].join("\n");
				ext = "csv";
			} else {
				content = JSON.stringify(exportRows, null, 2);
				ext = "json";
			}

			const blob = new Blob([content], {
				type: format === "csv" ? "text/csv" : "application/json",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `relog-export-${Date.now()}.${ext}`;
			a.click();
			URL.revokeObjectURL(url);
			setShowExport(false);
		},
		[live, stream.logs, rows],
	);

	// In live mode, prepend streamed logs on top of existing fetched logs
	const allLogs = live === "1"
		? (() => {
				const existingIds = new Set(rows.map((r) => r.id));
				const newLogs = stream.logs.filter((l) => !existingIds.has(l.id));
				return [...newLogs.reverse(), ...rows];
			})()
		: rows;
	// Show bookmarked logs filter only when not viewing around a specific log
	const logs = filters.bookmarked === "true" && !filters.around_id
		? allLogs.filter((l) => isBookmarked(`log:${l.id}`))
		: allLogs;

	// Only show date column when time range spans more than 24h
	const showDate =
		live !== "1" &&
		(() => {
			if (!filters.from) return false;
			const match = filters.from.match(/^(\d+)([smhdwMy])$/);
			if (match) {
				const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000, w: 604_800_000, M: 2_592_000_000, y: 31_536_000_000 };
				return parseInt(match[1]) * (ms[match[2]] ?? 3600_000) > 86400_000;
			}
			if (filters.to) {
				return new Date(filters.to).getTime() - new Date(filters.from).getTime() > 86400_000;
			}
			return false;
		})();

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineChart
				from={live === "1" ? "15m" : filters.from}
				to={live === "1" ? undefined : filters.to}
				filters={filters as Record<string, string | undefined>}
				refreshKey={live === "1" ? refreshKey : rows.length > 0 ? 1 : 0}
				buckets={bucketGranularity ?? (live === "1" ? 45 : undefined)}
				onTimeRangeSelect={live === "1" ? undefined : handleTimeRangeSelect}
				onResetTimeRange={live !== "1" ? () => onUpdateFilters({ from: undefined, to: undefined }) : undefined}
			>
				{(hoverBucket) => (<>
				<button
					type="button"
					onClick={toggleLive}
					className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
						live === "1"
							? "bg-emerald-500/15 text-emerald-500"
							: "text-muted-foreground hover:bg-muted hover:text-foreground"
					}`}
				>
					<Radio className="h-3 w-3" />
					Live
				</button>

				{live === "1" && (
					<>
						<div className="h-3 w-px bg-border" />
						<div className="flex items-center gap-1.5">
							<Circle
								className={`h-2 w-2 ${stream.connected ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
							/>
							<span className="text-[10px] text-muted-foreground">
								{stream.connected ? "Connected" : stream.paused ? "Paused" : "Disconnected"}
							</span>
						</div>
						<span className="text-[10px] text-muted-foreground tabular-nums">
							{stream.logs.length.toLocaleString()} events
						</span>
					</>
				)}

				{live !== "1" && loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
				{live !== "1" && error && <span className="text-xs text-destructive">{error}</span>}
				{live !== "1" && !loading && (
					<span className="text-[10px] text-muted-foreground">
						{total.toLocaleString()} results
						{total > 0 && ` (${rows.length} loaded)`}
					</span>
				)}

				<HoverStats bucket={hoverBucket} />

				<div className="flex-1" />

				<div className="flex items-center rounded-md border border-border overflow-hidden">
					<button
						type="button"
						onClick={() => setDetailMode("inline")}
						title="Inline detail"
						className={`flex items-center px-1.5 py-0.5 transition-colors ${
							detailMode === "inline"
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<AlignLeft className="h-3 w-3" />
					</button>
					<button
						type="button"
						onClick={() => setDetailMode("panel")}
						title="Side panel"
						className={`flex items-center px-1.5 py-0.5 transition-colors ${
							detailMode === "panel"
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						<PanelRight className="h-3 w-3" />
					</button>
				</div>

				<div className="flex items-center rounded-md border border-border px-2 py-0.5">
					<select
						value={bucketGranularity?.toString() || ""}
						onChange={(e) => setBucketGranularity(e.target.value ? Number(e.target.value) : undefined)}
						title="Chart bucket granularity"
						className="text-[10px] bg-transparent border-0 text-muted-foreground hover:text-foreground cursor-pointer outline-none appearance-none"
					>
						<option value="">Auto granularity</option>
						<option value="60">Granular (60 buckets)</option>
						<option value="45">Normal (45 buckets)</option>
						<option value="30">Coarse (30 buckets)</option>
						<option value="20">Very coarse (20 buckets)</option>
						<option value="12">Ultra coarse (12 buckets)</option>
					</select>
				</div>

				{live === "1" && (
					<>
						<button
							type="button"
							onClick={stream.clear}
							className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<Trash2 className="h-3 w-3" />
							Clear
						</button>
						<button
							type="button"
							onClick={stream.paused ? stream.resume : stream.pause}
							className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{stream.paused ? (
								<>
									<Play className="h-3 w-3" />
									Resume
								</>
							) : (
								<>
									<Pause className="h-3 w-3" />
									Pause
								</>
							)}
						</button>
					</>
				)}

				{live !== "1" && (
					<>
						<div className="relative">
							<button
								type="button"
								onClick={() => setShowExport(!showExport)}
								className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<Download className="h-3 w-3" />
								Export
							</button>
							{showExport && (
								<div className="absolute right-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md">
									<button
										type="button"
										onClick={() => exportData("json")}
										className="block w-full rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted"
									>
										Download JSON
									</button>
									<button
										type="button"
										onClick={() => exportData("csv")}
										className="block w-full rounded px-3 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted"
									>
										Download CSV
									</button>
								</div>
							)}
						</div>
						<button
							type="button"
							onClick={refetch}
							className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<RefreshCw className="h-3 w-3" />
							Refresh
						</button>
					</>
				)}
				</>)}
			</TimelineChart>
			<LogTable
				logs={logs}
				autoScroll={live === "1"}
				showDate={showDate}
				detailMode={(detailMode ?? "panel") as "inline" | "panel"}
				emptyMessage={
					live === "1"
						? stream.connected
							? "Waiting for logs..."
							: "Not connected"
						: loading
							? "Loading..."
							: "No logs found"
				}
				onNavigateTrace={onNavigateTrace}
				onLoadMore={live === "1" ? undefined : loadMore}
				loadingMore={loadingMore}
				hasMore={hasMore}
			/>
		</div>
	);
}
