import type { StatOptions } from "@/types";
import { WidgetError } from "../widget-renderer";
import { formatValue } from "./format";

export function StatWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: StatOptions;
}) {
	const row = rows[0];
	if (!row || !(options.valueField in row)) {
		return <WidgetError message={`Missing column: ${options.valueField}`} />;
	}
	const value = formatValue(row[options.valueField], options.format ?? "number");
	const delta =
		options.deltaField && options.deltaField in row
			? formatValue(row[options.deltaField], options.format ?? "number")
			: null;
	return (
		<div className="flex h-full flex-col justify-center gap-1 p-3">
			<div className="text-2xl font-semibold tabular-nums">{value}</div>
			{delta && <div className="text-xs text-muted-foreground">Δ {delta}</div>}
		</div>
	);
}
