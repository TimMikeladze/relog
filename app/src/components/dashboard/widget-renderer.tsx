import type { Widget } from "@/types";
import { Loader2 } from "lucide-react";
import { BarWidget } from "./widgets/bar";
import { GaugeWidget } from "./widgets/gauge";
import { HeatmapWidget } from "./widgets/heatmap";
import { LineWidget } from "./widgets/line";
import { SparklineWidget } from "./widgets/sparkline";
import { StatWidget } from "./widgets/stat";
import { StatusGridWidget } from "./widgets/status-grid";
import { TableWidget } from "./widgets/table";

export interface WidgetRenderProps {
	widget: Widget;
	rows: Record<string, unknown>[];
	columns: string[];
	loading: boolean;
	error: string | null;
	onReload?: () => void;
}

export function WidgetRenderer(props: WidgetRenderProps) {
	const { widget, rows, loading, error, onReload } = props;
	if (error) return <WidgetError message={error} onRetry={onReload} />;
	if (loading && rows.length === 0) return <WidgetLoading />;
	if (!loading && rows.length === 0) return <WidgetEmpty />;

	const options = widget.options as never;
	switch (widget.kind) {
		case "stat":
			return <StatWidget rows={rows} options={options} />;
		case "line":
			return <LineWidget rows={rows} options={options} />;
		case "bar":
			return <BarWidget rows={rows} options={options} />;
		case "table":
			return <TableWidget rows={rows} options={options} />;
		case "status-grid":
			return <StatusGridWidget rows={rows} options={options} />;
		case "heatmap":
			return <HeatmapWidget rows={rows} options={options} />;
		case "gauge":
			return <GaugeWidget rows={rows} options={options} />;
		case "sparkline":
			return <SparklineWidget rows={rows} options={options} />;
	}
}

export function WidgetError({ message, onRetry }: { message: string; onRetry?: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-xs">
			<span className="rounded-sm bg-destructive/10 px-2 py-1 font-medium text-destructive">
				{message}
			</span>
			{onRetry && (
				<button type="button" onClick={onRetry} className="text-muted-foreground underline">
					Retry
				</button>
			)}
		</div>
	);
}

export function WidgetLoading() {
	return (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
		</div>
	);
}

export function WidgetEmpty() {
	return (
		<div className="flex h-full items-center justify-center">
			<span className="text-xs italic text-muted-foreground">No data</span>
		</div>
	);
}
