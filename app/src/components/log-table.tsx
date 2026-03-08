import { useCallback, useEffect, useRef, useState } from "react";
import type { LogRecord } from "@/types";
import { LogRow } from "./log-row";
import { LogDetailPanel } from "./log-detail";
import { Loader2 } from "lucide-react";

export function LogTable({
	logs,
	autoScroll = false,
	showDate = false,
	emptyMessage = "No logs",
	onNavigateTrace,
	onLoadMore,
	loadingMore = false,
	hasMore = false,
}: {
	logs: LogRecord[];
	autoScroll?: boolean;
	showDate?: boolean;
	emptyMessage?: string;
	onNavigateTrace?: (traceId: string) => void;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	hasMore?: boolean;
}) {
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(autoScroll);

	const selectedLog = selectedId !== null ? logs.find((l) => l.id === selectedId) : null;

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;

		if (autoScroll) {
			const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
			stickToBottomRef.current = atBottom;
		}

		// Infinite scroll: load more when near bottom
		if (onLoadMore && hasMore && !loadingMore) {
			const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
			if (nearBottom) onLoadMore();
		}
	}, [autoScroll, onLoadMore, hasMore, loadingMore]);

	useEffect(() => {
		if (!autoScroll || !stickToBottomRef.current || !scrollRef.current) return;
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
	}, [logs, autoScroll]);

	if (logs.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className="flex flex-1 overflow-hidden">
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* Column headers */}
				<div className="flex shrink-0 items-center border-b border-border bg-muted/30 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground border-l-2 border-l-transparent">
					<span className={`shrink-0 px-3 py-1.5 ${showDate ? "w-[200px]" : "w-[110px]"}`}>Time</span>
					<span className="shrink-0 w-[52px] py-1.5">Level</span>
					<span className="shrink-0 w-[120px] py-1.5">Service</span>
					<span className="min-w-0 flex-1 py-1.5 pr-3">Message</span>
				</div>
				<div
					ref={scrollRef}
					onScroll={handleScroll}
					className="flex-1 overflow-y-auto log-rows"
				>
					{logs.map((log) => (
						<LogRow
							key={log.id}
							log={log}
							showDate={showDate}
							selected={log.id === selectedId}
							onClick={() => setSelectedId(log.id === selectedId ? null : log.id)}
						/>
					))}
					{loadingMore && (
						<div className="flex items-center justify-center py-3">
							<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
						</div>
					)}
				</div>
			</div>
			{selectedLog && (
				<LogDetailPanel
					log={selectedLog}
					onClose={() => setSelectedId(null)}
					onNavigateTrace={onNavigateTrace}
				/>
			)}
		</div>
	);
}
