import { useCallback, useEffect, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { useLogs } from "@/hooks/use-logs";
import { useStream } from "@/hooks/use-stream";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { LogTable } from "@/components/log-table";
import { LogEmptyState } from "@/components/log-empty";
import { TimelineChart } from "@/components/timeline-chart";
import {
	LIVE_ACTIVE_CLASS,
	ToolbarButton,
	ToolbarSegment,
	ToolbarSegments,
} from "@/components/layout/toolbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Filters } from "@/types";
import {
	Download,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Radio,
	Trash2,
	PanelRight,
	AlignLeft,
} from "lucide-react";

export function ExploreView({
	filters,
	enabled,
	onNavigateTrace,
	onUpdateFilters,
	onClearFilters,
}: {
	filters: Filters;
	enabled: boolean;
	onNavigateTrace?: (traceId: string) => void;
	onUpdateFilters: (updates: Partial<Filters>) => void;
	onClearFilters: () => void;
}) {
	const { isBookmarked } = useBookmarks();
	const [live, setLive] = useHashParam("live");
	const [detailMode, setDetailMode] = useHashParam("detail", "panel");
	const [showExport, setShowExport] = useState(false);
	const [bucketGranularity, setBucketGranularity] = useState<number | undefined>(undefined);

	const stream = useStream(filters, enabled && live === "1");
	const { rows, total, loading, loadingMore, error, loadMoreError, hasMore, loadMore, refetch } =
		useLogs(filters, enabled);

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
	const allLogs =
		live === "1"
			? (() => {
					const existingIds = new Set(rows.map((r) => r.id));
					const newLogs = stream.logs.filter((l) => !existingIds.has(l.id));
					return [...newLogs.reverse(), ...rows];
				})()
			: rows;
	// Show bookmarked logs filter only when not viewing around a specific log
	const logs =
		filters.bookmarked === "true" && !filters.around_id
			? allLogs.filter((l) => isBookmarked(`log:${l.id}`))
			: allLogs;

	// Only show date column when time range spans more than 24h
	const showDate =
		live !== "1" &&
		(() => {
			if (!filters.from) return false;
			const match = filters.from.match(/^(\d+)([smhdwMy])$/);
			if (match) {
				const ms: Record<string, number> = {
					s: 1000,
					m: 60_000,
					h: 3600_000,
					d: 86400_000,
					w: 604_800_000,
					M: 2_592_000_000,
					y: 31_536_000_000,
				};
				return parseInt(match[1]) * (ms[match[2]] ?? 3600_000) > 86400_000;
			}
			if (filters.to) {
				return new Date(filters.to).getTime() - new Date(filters.from).getTime() > 86400_000;
			}
			return false;
		})();

	const isLive = live === "1";

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineChart
				from={isLive ? "15m" : filters.from}
				to={isLive ? undefined : filters.to}
				filters={filters as Record<string, string | undefined>}
				refreshKey={isLive ? refreshKey : rows.length > 0 ? 1 : 0}
				buckets={bucketGranularity ?? (isLive ? 45 : undefined)}
				onBucketsChange={setBucketGranularity}
				onTimeRangeSelect={isLive ? undefined : handleTimeRangeSelect}
				onResetTimeRange={
					!isLive ? () => onUpdateFilters({ from: undefined, to: undefined }) : undefined
				}
				leading={
					<>
						<ToolbarButton
							onClick={toggleLive}
							active={isLive}
							icon={Radio}
							activeClassName={LIVE_ACTIVE_CLASS}
						>
							Live
						</ToolbarButton>

						{isLive ? (
							<span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
								{stream.paused
									? "Paused"
									: stream.connected
										? `${stream.logs.length.toLocaleString()} events`
										: "Disconnected"}
							</span>
						) : loading ? (
							<Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
						) : error ? (
							<span className="shrink-0 text-2xs text-destructive">{error}</span>
						) : (
							<span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
								{total.toLocaleString()} {total === 1 ? "result" : "results"}
								{total > rows.length && ` · ${rows.length.toLocaleString()} loaded`}
							</span>
						)}
					</>
				}
				trailing={
					<>
						{isLive && (
							<>
								<ToolbarButton onClick={stream.clear} icon={Trash2}>
									Clear
								</ToolbarButton>
								<ToolbarButton
									onClick={stream.paused ? stream.resume : stream.pause}
									icon={stream.paused ? Play : Pause}
								>
									{stream.paused ? "Resume" : "Pause"}
								</ToolbarButton>
							</>
						)}

						{!isLive && (
							<>
								<Popover open={showExport} onOpenChange={setShowExport}>
									<PopoverTrigger
										className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
										title="Export the loaded rows"
									>
										<Download className="size-3" />
										Export
									</PopoverTrigger>
									<PopoverContent align="end" sideOffset={6} className="w-44 gap-0 p-1">
										<button
											type="button"
											onClick={() => exportData("json")}
											className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										>
											Download JSON
										</button>
										<button
											type="button"
											onClick={() => exportData("csv")}
											className="w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
										>
											Download CSV
										</button>
									</PopoverContent>
								</Popover>
								<ToolbarButton onClick={refetch} icon={RefreshCw} title="Refresh results">
									Refresh
								</ToolbarButton>
							</>
						)}

						<div className="mx-0.5 h-3 w-px shrink-0 bg-border" />

						<ToolbarSegments>
							<ToolbarSegment
								active={detailMode === "inline"}
								onClick={() => setDetailMode("inline")}
								title="Expand details inline"
								icon={AlignLeft}
							/>
							<ToolbarSegment
								active={detailMode === "panel"}
								onClick={() => setDetailMode("panel")}
								title="Show details in a side panel"
								icon={PanelRight}
							/>
						</ToolbarSegments>
					</>
				}
			/>
			<LogTable
				logs={logs}
				autoScroll={isLive}
				showDate={showDate}
				detailMode={(detailMode ?? "panel") as "inline" | "panel"}
				empty={
					<LogEmptyState
						filters={filters}
						loading={!isLive && loading}
						live={isLive}
						streamConnected={stream.connected}
						onUpdateFilters={onUpdateFilters}
						onClearFilters={onClearFilters}
					/>
				}
				onNavigateTrace={onNavigateTrace}
				onLoadMore={isLive ? undefined : loadMore}
				loadingMore={loadingMore}
				loadMoreError={loadMoreError}
				hasMore={hasMore}
			/>
		</div>
	);
}
