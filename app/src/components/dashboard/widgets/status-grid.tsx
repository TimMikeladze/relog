import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { StatusGridOptions } from "@/types";
import { WidgetError } from "../widget-renderer";
import { STATUS_COLORS } from "./series-colors";

/**
 * Each state carries an icon as well as a colour. A bare coloured dot encodes
 * health in hue alone, which is exactly the encoding a red/green colourblind
 * reader can't see — and this grid is usually the "is anything on fire" widget.
 */
const STATES = {
	unknown: { color: "var(--color-muted-foreground)", label: "No data", Icon: HelpCircle },
	healthy: { color: STATUS_COLORS.good, label: "Healthy", Icon: CheckCircle2 },
	degraded: { color: STATUS_COLORS.warning, label: "Degraded", Icon: AlertTriangle },
	down: { color: STATUS_COLORS.critical, label: "Critical", Icon: XCircle },
} as const;

function statusFor(v: number, thresholds: { healthy: number; degraded: number }) {
	if (!Number.isFinite(v)) return STATES.unknown;
	if (v <= thresholds.healthy) return STATES.healthy;
	if (v <= thresholds.degraded) return STATES.degraded;
	return STATES.down;
}

export function StatusGridWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: StatusGridOptions;
}) {
	if (rows.length && (!(options.labelField in rows[0]) || !(options.statusField in rows[0]))) {
		return (
			<WidgetError message={`Missing column: ${options.labelField} or ${options.statusField}`} />
		);
	}
	return (
		<div className="grid h-full grid-cols-4 gap-2 p-3 sm:grid-cols-6 md:grid-cols-8">
			{rows.map((r, i) => {
				const value = Number(r[options.statusField]);
				const state = statusFor(value, options.thresholds);
				const { Icon } = state;
				const label = String(r[options.labelField]);
				const readout = Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
				return (
					<div
						key={i}
						className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-xs"
						title={`${label}: ${readout} — ${state.label}`}
					>
						<Icon className="size-3.5" style={{ color: state.color }} aria-hidden="true" />
						<span className="sr-only">{state.label}</span>
						<span className="w-full truncate text-center font-medium">{label}</span>
						<span className="tabular-nums text-muted-foreground">{readout}</span>
					</div>
				);
			})}
		</div>
	);
}
