import { Fragment } from "react";
import type { HeatmapOptions } from "@/types";
import { WidgetError } from "../widget-renderer";

export function HeatmapWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: HeatmapOptions;
}) {
	if (
		rows.length &&
		(!(options.xField in rows[0]) ||
			!(options.yField in rows[0]) ||
			!(options.valueField in rows[0]))
	) {
		return <WidgetError message="Missing x/y/value column" />;
	}
	const xs = Array.from(new Set(rows.map((r) => String(r[options.xField])))).sort();
	const ys = Array.from(new Set(rows.map((r) => String(r[options.yField])))).sort();
	const max = rows.reduce((m, r) => Math.max(m, Number(r[options.valueField]) || 0), 0) || 1;
	const cellMap = new Map<string, number>();
	for (const r of rows) {
		cellMap.set(
			`${r[options.xField]}::${r[options.yField]}`,
			Number(r[options.valueField]) || 0,
		);
	}
	return (
		<div className="h-full w-full overflow-auto p-2">
			<div
				className="grid gap-0.5"
				style={{ gridTemplateColumns: `auto repeat(${xs.length}, minmax(10px, 1fr))` }}
			>
				<div />
				{xs.map((x) => (
					<div key={x} className="truncate text-[10px] text-muted-foreground">
						{x}
					</div>
				))}
				{ys.map((y) => (
					<Fragment key={y}>
						<div className="truncate pr-1 text-[10px] text-muted-foreground">{y}</div>
						{xs.map((x) => {
							const v = cellMap.get(`${x}::${y}`) ?? 0;
							const intensity = v / max;
							return (
								<div
									key={`${x}-${y}`}
									className="h-4 rounded-sm"
									style={{
										background: `rgba(96, 165, 250, ${0.15 + intensity * 0.75})`,
									}}
									title={`${x} · ${y}: ${v}`}
								/>
							);
						})}
					</Fragment>
				))}
			</div>
		</div>
	);
}
