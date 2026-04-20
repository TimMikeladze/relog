import type { StatusGridOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

function statusColor(v: number, thresholds: { healthy: number; degraded: number }): string {
	if (!Number.isFinite(v)) return "bg-muted";
	if (v <= thresholds.healthy) return "bg-emerald-500";
	if (v <= thresholds.degraded) return "bg-amber-500";
	return "bg-red-500";
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
				const color = statusColor(value, options.thresholds);
				return (
					<div
						key={i}
						className="flex flex-col items-center gap-1 rounded-md border border-border p-2 text-xs"
						title={`${r[options.labelField]}: ${value.toFixed(2)}%`}
					>
						<span className={`h-3 w-3 rounded-full ${color}`} />
						<span className="truncate font-medium">{String(r[options.labelField])}</span>
						<span className="text-muted-foreground tabular-nums">{value.toFixed(2)}%</span>
					</div>
				);
			})}
		</div>
	);
}
