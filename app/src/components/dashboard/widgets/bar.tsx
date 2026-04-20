import type { BarOptions } from "@/types";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WidgetError } from "../widget-renderer";

export function BarWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: BarOptions;
}) {
	if (
		rows.length &&
		(!(options.categoryField in rows[0]) || !(options.valueField in rows[0]))
	) {
		return (
			<WidgetError
				message={`Missing column: ${options.categoryField} or ${options.valueField}`}
			/>
		);
	}
	const horizontal = options.orientation !== "vertical";
	return (
		<div className="h-full w-full p-1">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={rows}
					layout={horizontal ? "vertical" : "horizontal"}
					margin={{ top: 4, right: 8, bottom: 0, left: horizontal ? 60 : 0 }}
				>
					{horizontal ? (
						<>
							<XAxis type="number" hide />
							<YAxis
								type="category"
								dataKey={options.categoryField}
								tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
								axisLine={false}
								tickLine={false}
								width={55}
							/>
						</>
					) : (
						<>
							<XAxis
								dataKey={options.categoryField}
								tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
						</>
					)}
					<Tooltip
						contentStyle={{
							fontSize: 11,
							background: "var(--color-popover)",
							border: "1px solid var(--color-border)",
							borderRadius: 6,
						}}
					/>
					<Bar
						dataKey={options.valueField}
						fill="var(--color-primary)"
						fillOpacity={0.6}
						radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
					>
						{rows.map((_, i) => (
							<Cell key={i} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
