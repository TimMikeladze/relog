import { useState, useCallback, useEffect, useRef } from "react";
import { useLogs } from "@/hooks/use-logs";
import { useStream } from "@/hooks/use-stream";
import { LogTable } from "@/components/log-table";
import { Pagination } from "@/components/pagination";
import { TimelineStrip } from "@/components/timeline-strip";
import type { Filters } from "@/types";
import { Circle, Download, Loader2, Pause, Play, RefreshCw, Radio, Trash2 } from "lucide-react";

export function ExploreView({
	filters,
	page,
	onPageChange,
	enabled,
	onNavigateTrace,
	onUpdateFilters,
}: {
	filters: Filters;
	page: number;
	onPageChange: (page: number) => void;
	enabled: boolean;
	onNavigateTrace?: (traceId: string) => void;
	onUpdateFilters: (updates: Partial<Filters>) => void;
}) {
	const [live, setLive] = useState(false);
	const [showExport, setShowExport] = useState(false);

	const stream = useStream(filters, enabled && live);
	const { data, loading, error, refetch } = useLogs(filters, page, enabled && !live);

	const [refreshKey, setRefreshKey] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

	useEffect(() => {
		if (!live) return;
		intervalRef.current = setInterval(() => setRefreshKey((k) => k + 1), 10_000);
		return () => clearInterval(intervalRef.current);
	}, [live]);

	const toggleLive = useCallback(() => {
		setLive((prev) => !prev);
	}, []);

	const handleTimeRangeSelect = useCallback(
		(from: string, to: string) => {
			onUpdateFilters({ from, to });
		},
		[onUpdateFilters],
	);

	const exportData = useCallback(
		(format: "json" | "csv") => {
			const rows = live ? stream.logs : data?.rows;
			if (!rows?.length) return;
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
				const csvRows = rows.map((r) =>
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
				content = JSON.stringify(rows, null, 2);
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
		[live, stream.logs, data],
	);

	const logs = live ? stream.logs : (data?.rows ?? []);

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineStrip
				from={live ? "15m" : filters.from}
				to={live ? undefined : filters.to}
				filters={filters as Record<string, string | undefined>}
				refreshKey={live ? refreshKey : data ? 1 : 0}
				buckets={live ? 45 : 60}
				onTimeRangeSelect={live ? undefined : handleTimeRangeSelect}
			/>
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5">
				<button
					type="button"
					onClick={toggleLive}
					className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
						live
							? "bg-emerald-500/15 text-emerald-500"
							: "text-muted-foreground hover:bg-muted hover:text-foreground"
					}`}
				>
					<Radio className="h-3 w-3" />
					Live
				</button>

				{live && (
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

				{!live && loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
				{!live && error && <span className="text-xs text-destructive">{error}</span>}
				{!live && data && !loading && (
					<span className="text-[10px] text-muted-foreground">
						{data.total.toLocaleString()} results
						{data.total > 0 && ` (${data.rows.length} shown)`}
					</span>
				)}

				<div className="flex-1" />

				{live && (
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

				{!live && (
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
			</div>
			<LogTable
				logs={logs}
				autoScroll={live}
				showDate={!live}
				emptyMessage={
					live
						? stream.connected
							? "Waiting for logs..."
							: "Not connected"
						: loading
							? "Loading..."
							: "No logs found"
				}
				onNavigateTrace={onNavigateTrace}
			/>
			{!live && data && (
				<Pagination page={page} total={data.total} limit={data.limit} onPageChange={onPageChange} />
			)}
		</div>
	);
}
