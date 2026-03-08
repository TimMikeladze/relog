import { memo } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LogRecord } from "@/types";

const LEVEL_BORDERS: Record<string, string> = {
	trace: "border-l-zinc-400/40",
	debug: "border-l-blue-400/40",
	info: "border-l-emerald-400/60",
	warn: "border-l-amber-400/70",
	error: "border-l-red-400/80",
	fatal: "border-l-fuchsia-400/80",
};

const LEVEL_TEXT: Record<string, string> = {
	trace: "text-zinc-500 dark:text-zinc-500",
	debug: "text-blue-500 dark:text-blue-400",
	info: "text-emerald-600 dark:text-emerald-400",
	warn: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
	fatal: "text-fuchsia-600 dark:text-fuchsia-400",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function formatTime(timestamp: string): string {
	try {
		const d = new Date(timestamp);
		const h = String(d.getHours()).padStart(2, "0");
		const m = String(d.getMinutes()).padStart(2, "0");
		const s = String(d.getSeconds()).padStart(2, "0");
		const ms = String(d.getMilliseconds()).padStart(3, "0").slice(0, 2);
		return `${h}:${m}:${s}.${ms}`;
	} catch {
		return timestamp;
	}
}

function formatDateTime(timestamp: string): string {
	try {
		const d = new Date(timestamp);
		const time = formatTime(timestamp);
		return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${time}`;
	} catch {
		return timestamp;
	}
}

export const LogRow = memo(function LogRow({
	log,
	selected,
	onClick,
	showDate = false,
	isBookmarked = false,
	onToggleBookmark,
}: {
	log: LogRecord;
	selected?: boolean;
	onClick?: () => void;
	showDate?: boolean;
	isBookmarked?: boolean;
	onToggleBookmark?: (e: React.MouseEvent) => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"group flex w-full items-center border-l-2 text-left text-xs transition-colors hover:bg-muted/40",
				LEVEL_BORDERS[log.level] || "border-l-transparent",
				selected && "bg-muted/60",
			)}
		>
			{/* Timestamp */}
			<span
				className={cn(
					"shrink-0 px-3 py-[5px] text-muted-foreground tabular-nums",
					showDate ? "w-[200px]" : "w-[110px]",
				)}
			>
				{showDate ? formatDateTime(log.timestamp) : formatTime(log.timestamp)}
			</span>

			{/* Level */}
			<span
				className={cn(
					"shrink-0 w-[52px] py-[5px] text-[10px] font-semibold uppercase tracking-wider",
					LEVEL_TEXT[log.level] || "text-muted-foreground",
				)}
			>
				{log.level}
			</span>

			{/* Service */}
			<span className="shrink-0 w-[120px] py-[5px] truncate text-muted-foreground">
				{log.service || ""}
			</span>

			{/* Message */}
			<span className="min-w-0 flex-1 py-[5px] pr-3 truncate">{log.message}</span>

			{/* Bookmark */}
			{onToggleBookmark && (
				<span
					role="button"
					tabIndex={-1}
					onClick={onToggleBookmark}
					onKeyDown={(e) => e.key === "Enter" && onToggleBookmark(e as unknown as React.MouseEvent)}
					className={cn(
						"shrink-0 mr-2 rounded p-0.5 transition-colors",
						isBookmarked
							? "text-amber-400"
							: "text-transparent group-hover:text-muted-foreground hover:!text-amber-400",
					)}
				>
					{isBookmarked ? <BookmarkCheck className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
				</span>
			)}
		</button>
	);
});
