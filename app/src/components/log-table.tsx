import { useCallback, useEffect, useRef, useState } from "react";
import type { LogRecord } from "@/types";
import { LogRow } from "./log-row";
import { LogDetailPanel } from "./log-detail";

export function LogTable({
	logs,
	autoScroll = false,
	showDate = false,
	emptyMessage = "No logs",
	onNavigateTrace,
}: {
	logs: LogRecord[];
	autoScroll?: boolean;
	showDate?: boolean;
	emptyMessage?: string;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(autoScroll);

	const selectedLog = selectedId !== null ? logs.find((l) => l.id === selectedId) : null;

	const handleScroll = useCallback(() => {
		if (!autoScroll || !scrollRef.current) return;
		const el = scrollRef.current;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		stickToBottomRef.current = atBottom;
	}, [autoScroll]);

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
				<div
					ref={scrollRef}
					onScroll={handleScroll}
					className="flex-1 overflow-y-auto divide-y divide-border/50"
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
