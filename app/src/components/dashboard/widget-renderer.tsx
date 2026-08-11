import type {
	BarOptions,
	GaugeOptions,
	HeatmapOptions,
	LineOptions,
	SparklineOptions,
	StatOptions,
	StatusGridOptions,
	TableOptions,
	Widget,
} from "@/types";
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
	/** True when `rows` is the previous successful result and a fresh fetch failed. */
	stale?: boolean;
	onReload?: () => void;
}

export function WidgetRenderer(props: WidgetRenderProps) {
	const { widget, rows, loading, error, stale, onReload } = props;
	// If we have prior data and the latest fetch failed, prefer showing
	// the stale chart with a small badge over a full-screen error. This
	// is the dashboard isolation behavior — one flaky widget shouldn't
	// blank itself out and lose context.
	if (error && rows.length === 0) {
		return <WidgetError message={error} onRetry={onReload} />;
	}
	if (loading && rows.length === 0) return <WidgetLoading />;
	if (!loading && rows.length === 0) return <WidgetEmpty />;

	const body = renderWidgetBody(widget, rows);
	if (error || stale) {
		return (
			<div className="relative h-full">
				{body}
				<div
					className="absolute right-2 top-2 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-2xs font-medium text-destructive"
					title={error ?? undefined}
				>
					{error ? "Stale · refresh failed" : "Stale"}
				</div>
			</div>
		);
	}
	return body;
}

function renderWidgetBody(widget: Widget, rows: Record<string, unknown>[]) {
	switch (widget.kind) {
		case "stat":
			return <StatWidget rows={rows} options={widget.options as StatOptions} />;
		case "line":
			return <LineWidget rows={rows} options={widget.options as LineOptions} />;
		case "bar":
			return <BarWidget rows={rows} options={widget.options as BarOptions} />;
		case "table":
			return <TableWidget rows={rows} options={widget.options as TableOptions} />;
		case "status-grid":
			return <StatusGridWidget rows={rows} options={widget.options as StatusGridOptions} />;
		case "heatmap":
			return <HeatmapWidget rows={rows} options={widget.options as HeatmapOptions} />;
		case "gauge":
			return <GaugeWidget rows={rows} options={widget.options as GaugeOptions} />;
		case "sparkline":
			return <SparklineWidget rows={rows} options={widget.options as SparklineOptions} />;
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
