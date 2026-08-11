import { LevelBadge } from "@/components/level-badge";
import { LOG_LEVELS } from "@/lib/log-filters";
import type { LogLevel, TableOptions } from "@/types";
import { formatValue } from "./format";

const LEVEL_SET = new Set<string>(LOG_LEVELS);

/**
 * A `level` column gets the same badge it has everywhere else. Rendering it as
 * bare lowercase text made the dashboard the one place in the app where
 * severity carried no colour at all.
 */
function Cell({ field, value, format }: { field: string; value: unknown; format?: string }) {
	if (field === "level" && typeof value === "string" && LEVEL_SET.has(value)) {
		return <LevelBadge level={value as LogLevel} />;
	}
	return <>{formatValue(value, format as never)}</>;
}

export function TableWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: TableOptions;
}) {
	return (
		<div className="h-full overflow-auto p-1">
			<table className="w-full text-xs">
				<thead className="sticky top-0 bg-background">
					<tr className="border-b border-border">
						{options.columns.map((c) => (
							<th key={c.field} className="px-2 py-1 text-left font-medium text-muted-foreground">
								{c.label ?? c.field}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className="border-b border-border/40">
							{options.columns.map((c) => (
								<td key={c.field} className="truncate px-2 py-1 tabular-nums">
									<Cell field={c.field} value={row[c.field]} format={c.format} />
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
