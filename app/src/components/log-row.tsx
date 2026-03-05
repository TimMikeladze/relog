import { cn } from "@/lib/utils";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";

function formatTime(timestamp: string): string {
	try {
		const d = new Date(timestamp);
		return d.toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
	} catch {
		return timestamp;
	}
}

function formatDateTime(timestamp: string): string {
	try {
		const d = new Date(timestamp);
		return (
			d.toLocaleDateString("en-US", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
			}) +
			" " +
			d.toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 })
		);
	} catch {
		return timestamp;
	}
}

export function LogRow({
	log,
	selected,
	onClick,
	showDate = false,
}: {
	log: LogRecord;
	selected?: boolean;
	onClick?: () => void;
	showDate?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-center gap-3 px-3 py-1 text-left font-mono text-xs transition-colors hover:bg-muted/50",
				selected && "bg-muted",
			)}
		>
			<span className="shrink-0 text-muted-foreground tabular-nums">
				{showDate ? formatDateTime(log.timestamp) : formatTime(log.timestamp)}
			</span>
			<span className="shrink-0">
				<LevelBadge level={log.level} />
			</span>
			{log.service && (
				<span className="shrink-0 max-w-[120px] truncate text-muted-foreground">{log.service}</span>
			)}
			<span className="min-w-0 flex-1 truncate">{log.message}</span>
		</button>
	);
}
