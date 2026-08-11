import { levelColor } from "@/lib/log-filters";
import { cn } from "@/lib/utils";
import type { LogLevel } from "@/types";

/**
 * Tinted from the shared level tokens rather than its own palette. It used to
 * carry a fourth, independent set of colours, which is how `info` ended up
 * emerald in the filter list, cyan here, and teal in the chart.
 */
export function LevelBadge({ level, className }: { level: LogLevel; className?: string }) {
	const color = levelColor(level);
	return (
		<span
			className={cn(
				"inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ring-1 ring-inset",
				className,
			)}
			style={
				{
					color,
					background: `color-mix(in oklch, ${color} 14%, transparent)`,
					"--tw-ring-color": `color-mix(in oklch, ${color} 26%, transparent)`,
				} as React.CSSProperties
			}
		>
			{level}
		</span>
	);
}
