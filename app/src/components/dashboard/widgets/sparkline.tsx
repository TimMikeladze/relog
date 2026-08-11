import type { SparklineOptions } from "@/types";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { WidgetError } from "../widget-renderer";
import { seriesColor } from "./series-colors";

export function SparklineWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: SparklineOptions;
}) {
	if (rows.length && (!(options.xField in rows[0]) || !(options.yField in rows[0]))) {
		return <WidgetError message={`Missing column: ${options.xField} or ${options.yField}`} />;
	}
	return (
		<div className="h-full w-full p-2">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={rows}>
					<Line
						type="monotone"
						dataKey={options.yField}
						stroke={seriesColor(0)}
						strokeWidth={2}
						dot={false}
						isAnimationActive={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
