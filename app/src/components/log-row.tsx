import { memo } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { levelColor } from "@/lib/log-filters";
import { cn } from "@/lib/utils";
import type { LogRecord } from "@/types";

/**
 * Only the levels you'd stop scrolling for get an edge marker. Striping every
 * row with its level colour turned a screen of routine `info` into thirty
 * green bars, which is exactly as useful as no bars at all.
 */
const ACCENTED_LEVELS = new Set(["warn", "error", "fatal"]);

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
	// `id` is passed back to the parent so it can keep one stable handler
	// across all rows. With per-row arrow functions the LogRow `memo`
	// wrapper was defeated and 2k buffered rows re-rendered every tick.
	onClick?: (id: number) => void;
	showDate?: boolean;
	isBookmarked?: boolean;
	onToggleBookmark?: (id: number, e: React.MouseEvent) => void;
}) {
	const handleClick = onClick ? () => onClick(log.id) : undefined;
	const handleBookmark = onToggleBookmark
		? (e: React.MouseEvent) => onToggleBookmark(log.id, e)
		: undefined;
	return (
		<button
			type="button"
			onClick={handleClick}
			className={cn(
				"group flex w-full items-center border-l-2 text-left text-sm/5 hover:bg-accent/60",
				selected ? "border-l-primary bg-accent" : "border-l-transparent",
			)}
			style={
				!selected && ACCENTED_LEVELS.has(log.level)
					? { borderLeftColor: levelColor(log.level) }
					: undefined
			}
		>
			{/* Timestamp */}
			<span
				className={cn(
					"shrink-0 px-3 py-1 font-mono text-2xs tabular-nums text-muted-foreground",
					showDate ? "w-[168px]" : "w-[104px]",
				)}
			>
				{showDate ? formatDateTime(log.timestamp) : formatTime(log.timestamp)}
			</span>

			{/* Level — colour carries the severity, so the label can stay quiet */}
			<span className="w-[56px] shrink-0 py-1">
				<span
					className="text-2xs font-semibold uppercase tracking-wide"
					style={{ color: levelColor(log.level) }}
				>
					{log.level}
				</span>
			</span>

			{/* Service */}
			<span className="w-[124px] shrink-0 truncate py-1 pr-2 text-xs text-muted-foreground">
				{log.service || "—"}
			</span>

			{/* Message */}
			<span className="min-w-0 flex-1 truncate py-1 pr-3">{log.message}</span>

			{/* Bookmark */}
			{handleBookmark && (
				<span
					role="button"
					tabIndex={-1}
					aria-label={isBookmarked ? "Remove bookmark" : "Bookmark this log"}
					onClick={handleBookmark}
					onKeyDown={(e) => e.key === "Enter" && handleBookmark(e as unknown as React.MouseEvent)}
					className={cn(
						"mr-2 shrink-0 rounded p-0.5",
						isBookmarked
							? "text-primary"
							: "text-transparent group-hover:text-muted-foreground hover:!text-primary",
					)}
				>
					{isBookmarked ? (
						<BookmarkCheck className="size-3.5" />
					) : (
						<Bookmark className="size-3.5" />
					)}
				</span>
			)}
		</button>
	);
});
