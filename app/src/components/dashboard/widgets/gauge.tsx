import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { GaugeOptions } from "@/types";
import { WidgetError } from "../widget-renderer";
import { STATUS_COLORS } from "./series-colors";

const STATES = {
	good: { color: STATUS_COLORS.good, label: "OK", Icon: CheckCircle2 },
	warning: { color: STATUS_COLORS.warning, label: "Warning", Icon: AlertTriangle },
	critical: { color: STATUS_COLORS.critical, label: "Critical", Icon: XCircle },
} as const;

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

	const state =
		options.thresholds && value >= options.thresholds.crit
			? STATES.critical
			: options.thresholds && value >= options.thresholds.warn
				? STATES.warning
				: STATES.good;
	const { Icon } = state;

	return (
		<div className="flex h-full flex-col items-center justify-center gap-1.5 p-3">
			<div className="relative h-20 w-20">
				<svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
					<circle cx="18" cy="18" r="16" fill="none" stroke="var(--color-border)" strokeWidth="3" />
					<circle
						cx="18"
						cy="18"
						r="16"
						fill="none"
						stroke={state.color}
						strokeWidth="3"
						strokeDasharray={`${pct * 100.5} ${100.5}`}
						strokeLinecap="round"
					/>
				</svg>
				<div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
					{value.toFixed(0)}
				</div>
			</div>
			{/* A status reading is never colour-alone: the arc's meaning has to
			    survive both colourblindness and a greyscale print. */}
			{options.thresholds && (
				<div className="flex items-center gap-1 text-2xs text-muted-foreground">
					<Icon className="size-3" style={{ color: state.color }} />
					{state.label}
				</div>
			)}
		</div>
	);
}
