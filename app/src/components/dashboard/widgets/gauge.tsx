import type { GaugeOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

export function GaugeWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: GaugeOptions;
}) {
	const row = rows[0];
	if (!row || !(options.valueField in row)) {
		return <WidgetError message={`Missing column: ${options.valueField}`} />;
	}
	const value = Number(row[options.valueField]);
	const min = options.min ?? 0;
	const pct = Math.max(0, Math.min(1, (value - min) / (options.max - min || 1)));
	let color = "#34d399";
	if (options.thresholds && value >= options.thresholds.crit) color = "#f87171";
	else if (options.thresholds && value >= options.thresholds.warn) color = "#fbbf24";

	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-3">
			<div className="relative h-20 w-20">
				<svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
					<circle cx="18" cy="18" r="16" fill="none" stroke="var(--color-border)" strokeWidth="3" />
					<circle
						cx="18"
						cy="18"
						r="16"
						fill="none"
						stroke={color}
						strokeWidth="3"
						strokeDasharray={`${pct * 100.5} ${100.5}`}
						strokeLinecap="round"
					/>
				</svg>
				<div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
					{value.toFixed(0)}
				</div>
			</div>
		</div>
	);
}
