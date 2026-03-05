import { cn } from "@/lib/utils";
import type { LogLevel } from "@/types";

const levelColors: Record<LogLevel, string> = {
	trace: "bg-zinc-500/15 text-zinc-500 dark:bg-zinc-400/15 dark:text-zinc-400",
	debug: "bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400",
	info: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
	warn: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
	error: "bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-400",
	fatal: "bg-fuchsia-500/15 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-400",
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
