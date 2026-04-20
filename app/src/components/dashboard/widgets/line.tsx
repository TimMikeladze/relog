import type { LineOptions } from "@/types";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { WidgetError } from "../widget-renderer";
import { formatValue } from "./format";

const LINE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];

export function LineWidget({
	rows,
	options,
}: {
	rows: Record<string, unknown>[];
	options: LineOptions;
}) {
	if (rows.length && !(options.xField in rows[0])) {
		return <WidgetError message={`Missing x column: ${options.xField}`} />;
	}

	const pivoting = !!options.seriesField && options.yFields.length === 1;

	if (pivoting) {
		const valueField = options.yFields[0];
		if (rows.length && !(valueField in rows[0])) {
			return <WidgetError message={`Missing y column: ${valueField}`} />;
		}
		if (rows.length && options.seriesField && !(options.seriesField in rows[0])) {
			return <WidgetError message={`Missing series column: ${options.seriesField}`} />;
		}
	} else {
		const missingY = options.yFields.find((f) => rows.length && !(f in rows[0]));
		if (missingY) return <WidgetError message={`Missing y column: ${missingY}`} />;
	}

	let chartRows: Record<string, unknown>[] = rows;
	let seriesKeys: string[] = options.yFields;

	if (pivoting && options.seriesField) {
		const seriesField = options.seriesField;
		const valueField = options.yFields[0];
		const buckets = new Map<string, Record<string, unknown>>();
		const seen = new Set<string>();
		for (const r of rows) {
			const x = r[options.xField];
			const key = String(x);
			const s = String(r[seriesField] ?? "—");
			seen.add(s);
			let row = buckets.get(key);
			if (!row) {
				row = { [options.xField]: x };
				buckets.set(key, row);
			}
			row[s] = r[valueField];
		}
		chartRows = Array.from(buckets.values());
		seriesKeys = Array.from(seen).sort();
	}

	return (
		<div className="h-full w-full p-1">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={chartRows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
					<CartesianGrid stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
					<XAxis
						dataKey={options.xField}
						tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
						axisLine={false}
						tickLine={false}
						tickFormatter={(v) => formatValue(v, "timestamp").replace(/.* /, "")}
					/>
					<YAxis
						tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
						axisLine={false}
						tickLine={false}
						width={40}
						tickFormatter={(v) => formatValue(v, options.yFormat ?? "number")}
					/>
					<Tooltip
						contentStyle={{
							fontSize: 11,
							background: "var(--color-popover)",
							border: "1px solid var(--color-border)",
							borderRadius: 6,
						}}
						labelFormatter={(v) => formatValue(v, "timestamp")}
						formatter={(v: unknown) => formatValue(v, options.yFormat ?? "number")}
					/>
					{seriesKeys.map((f, i) => (
						<Line
							key={f}
							type="monotone"
							dataKey={f}
							stroke={LINE_COLORS[i % LINE_COLORS.length]}
							strokeWidth={2}
							dot={false}
							isAnimationActive={false}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
