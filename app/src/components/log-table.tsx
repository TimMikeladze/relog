import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import type { LogRecord } from "@/types";
import { LogRow } from "./log-row";
import { LogDetailPanel } from "./log-detail";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { Loader2 } from "lucide-react";

export function LogTable({
	logs,
	autoScroll = false,
	showDate = false,
	empty,
	onNavigateTrace,
	onLoadMore,
	loadingMore = false,
	loadMoreError,
	hasMore = false,
	detailMode = "panel",
}: {
	logs: LogRecord[];
	autoScroll?: boolean;
	showDate?: boolean;
	/** Rendered in place of the rows when there are none. */
	empty?: React.ReactNode;
	onNavigateTrace?: (traceId: string) => void;
	onLoadMore?: () => void;
	loadingMore?: boolean;
	loadMoreError?: string | null;
	hasMore?: boolean;
	detailMode?: "inline" | "panel";
}) {
	const { isBookmarked, toggle } = useBookmarks();

	// Panel mode: single selected id; inline mode: set of expanded ids
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(autoScroll);

	// Latest-logs ref so the stable bookmark/click handlers below can read
	// the current row without re-binding when `logs` changes (which would
	// invalidate the memoized LogRow callbacks every render).
	const logsRef = useRef(logs);
	logsRef.current = logs;

	// Memoize the lookup so `logs.find` doesn't run on every render of an
	// unrelated state change (e.g. live-stream tick when nothing is selected).
	const selectedLog = useMemo(
		() => (selectedId !== null ? (logs.find((l) => l.id === selectedId) ?? null) : null),
		[selectedId, logs],
	);

	const handleSelectInline = useCallback((id: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleSelectPanel = useCallback((id: number) => {
		setSelectedId((prev) => (prev === id ? null : id));
	}, []);

	const handleToggleBookmark = useCallback(
		(id: number, e: React.MouseEvent) => {
			e.stopPropagation();
			const log = logsRef.current.find((l) => l.id === id);
			if (!log) return;
			toggle({
				type: "log",
				label: log.message.slice(0, 80),
				timestamp: log.timestamp,
				level: log.level,
				service: log.service ?? undefined,
				logRecord: log,
			});
		},
		[toggle],
	);

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
		return <div className="flex flex-1 flex-col overflow-hidden">{empty}</div>;
	}

	const columnHeaders = (
		<div className="flex shrink-0 items-center border-b border-border border-l-2 border-l-transparent bg-card text-2xs font-medium text-muted-foreground">
			<span className={`shrink-0 px-3 py-1.5 ${showDate ? "w-[168px]" : "w-[104px]"}`}>Time</span>
			<span className="w-[56px] shrink-0 py-1.5">Level</span>
			<span className="w-[124px] shrink-0 py-1.5">Service</span>
			<span className="min-w-0 flex-1 py-1.5 pr-3">Message</span>
		</div>
	);

	const footer = (
		<>
			{loadingMore && (
				<div className="flex items-center justify-center gap-2 py-3 text-2xs text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					Loading more…
				</div>
			)}
			{/* `useLogs` has always reported pagination failures; nothing rendered
			    them, so a failed page just looked like the end of the results. */}
			{loadMoreError && !loadingMore && (
				<div className="flex items-center justify-center gap-2 py-3 text-2xs text-destructive">
					{loadMoreError}
					{onLoadMore && (
						<button
							type="button"
							onClick={onLoadMore}
							className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-accent"
						>
							Retry
						</button>
					)}
				</div>
			)}
			{!hasMore && !loadingMore && logs.length > 20 && (
				<div className="py-3 text-center text-2xs text-muted-foreground">End of results</div>
			)}
		</>
	);

	if (detailMode === "inline") {
		return (
			<div className="flex flex-1 flex-col overflow-hidden">
				{columnHeaders}
				<div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto log-rows">
					{logs.map((log) => {
						const expanded = expandedIds.has(log.id);
						return (
							<div key={log.id}>
								<LogRow
									log={log}
									showDate={showDate}
									selected={expanded}
									isBookmarked={isBookmarked(`log:${log.id}`)}
									onToggleBookmark={handleToggleBookmark}
									onClick={handleSelectInline}
								/>
								{expanded && (
									<div className="mx-2 mb-2 max-h-[520px] overflow-y-auto">
										<LogDetailPanel
											log={log}
											onClose={() => handleSelectInline(log.id)}
											onNavigateTrace={onNavigateTrace}
											variant="inline"
										/>
									</div>
								)}
							</div>
						);
					})}
					{footer}
				</div>
			</div>
		);
	}

	return (
		<PanelGroup className="flex-1 overflow-hidden" id="relog-logtable">
			<Panel id="logs" minSize="30%">
				<div className="flex h-full flex-col overflow-hidden">
					{columnHeaders}
					<div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto log-rows">
						{logs.map((log) => (
							<LogRow
								key={log.id}
								log={log}
								showDate={showDate}
								selected={log.id === selectedId}
								isBookmarked={isBookmarked(`log:${log.id}`)}
								onToggleBookmark={handleToggleBookmark}
								onClick={handleSelectPanel}
							/>
						))}
						{footer}
					</div>
				</div>
			</Panel>
			{selectedLog && (
				<>
					<PanelResizeHandle className="resize-handle" />
					<Panel id="detail" defaultSize="30%" minSize="300px" maxSize="50%">
						<LogDetailPanel
							log={selectedLog}
							onClose={() => setSelectedId(null)}
							onNavigateTrace={onNavigateTrace}
						/>
					</Panel>
				</>
			)}
		</PanelGroup>
	);
}
