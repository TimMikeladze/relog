import type { TableOptions } from "@/types";
import { formatValue } from "./format";

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
							<th
								key={c.field}
								className="px-2 py-1 text-left font-medium text-muted-foreground"
							>
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
									{formatValue(row[c.field], c.format)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
