import { cn } from "@/lib/utils";
import type { LogLevel } from "@/types";

const levelColors: Record<LogLevel, string> = {
	trace: "bg-zinc-500/15 text-zinc-500 dark:bg-zinc-400/15 dark:text-zinc-400",
	debug: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-400",
	info: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-400",
	warn: "bg-amber-500/15 text-amber-600 dark:bg-amber-300/15 dark:text-amber-300",
	error: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
	fatal: "bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-400",
};

export function LevelBadge({ level, className }: { level: LogLevel; className?: string }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
				levelColors[level] ?? levelColors.info,
				className,
			)}
		>
			{level}
		</span>
	);
}
