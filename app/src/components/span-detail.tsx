import type { LogLevel, LogRecord, SpanBar } from "@/types";
import { LevelBadge } from "@/components/level-badge";
import { JsonViewer } from "@/components/json-viewer";
import { getServiceColor } from "@/components/service-colors";
import { formatClockTime as formatTime } from "@/lib/format-time";
import { X } from "lucide-react";
import { useMemo } from "react";

const OTEL_META_KEYS = new Set([
	"otel",
	"otel_event",
	"span_kind",
	"span_status_code",
	"span_status_message",
	"instrumentation_scope",
	"resource",
	"severity_number",
	"severity_text",
	"duration_ms",
]);

const SPAN_STATUS_LABEL: Record<number, string> = {
	0: "unset",
	1: "ok",
	2: "error",
};

interface SpanDetailProps {
	span: SpanBar;
	logs: LogRecord[];
	onClose: () => void;
	variant?: "panel" | "inline";
}

function parseMeta(meta: LogRecord["meta"]): Record<string, unknown> | null {
	if (!meta) return null;
	if (typeof meta === "string") {
		try {
			return JSON.parse(meta);
		} catch {
			return null;
		}
	}
	return meta;
}

function formatDuration(ms: number): string {
	return `${ms.toLocaleString()}ms`;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
	return (
		<div className="pt-3 pb-1.5">
			<span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
				{children}
			</span>
		</div>
	);
}

function AttributeRow({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: React.ReactNode;
	mono?: boolean;
}) {
	return (
		<div className="flex items-baseline justify-between gap-2 py-1">
			<span className="shrink-0 text-2xs text-muted-foreground/80 font-medium">{label}</span>
			<span
				className={`text-right text-xs truncate max-w-[200px] text-foreground/70 ${mono ? "font-mono" : ""}`}
			>
				{value}
			</span>
		</div>
	);
}

export function SpanDetail({ span, logs, onClose, variant = "panel" }: SpanDetailProps) {
	const serviceColor = getServiceColor(span.service);

	const spanLogs = useMemo(
		() => logs.filter((l) => l.span_id === span.spanId),
		[logs, span.spanId],
	);

	// Pick the representative log for OTel metadata: prefer a non-event span log
	// with duration_ms, otherwise fall back to the first span log.
	const representativeMeta = useMemo<Record<string, unknown> | null>(() => {
		const primary =
			spanLogs.find((l) => {
				const meta = parseMeta(l.meta);
				return meta && meta.otel === true && !meta.otel_event;
			}) ?? spanLogs[0];
		return primary ? parseMeta(primary.meta) : null;
	}, [spanLogs]);

	const otelFields = useMemo(() => {
		if (!representativeMeta) {
			return {
				isOtel: false,
				kind: undefined as string | undefined,
				statusCode: undefined as number | undefined,
				statusMessage: undefined as string | undefined,
				scope: undefined as string | undefined,
				resource: undefined as Record<string, unknown> | undefined,
				spanAttrs: {} as Record<string, unknown>,
			};
		}
		const m = representativeMeta;
		const spanAttrs: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(m)) {
			if (!OTEL_META_KEYS.has(k)) spanAttrs[k] = v;
		}
		return {
			isOtel: m.otel === true,
			kind: typeof m.span_kind === "string" ? m.span_kind : undefined,
			statusCode: typeof m.span_status_code === "number" ? m.span_status_code : undefined,
			statusMessage: typeof m.span_status_message === "string" ? m.span_status_message : undefined,
			scope: typeof m.instrumentation_scope === "string" ? m.instrumentation_scope : undefined,
			resource:
				m.resource && typeof m.resource === "object"
					? (m.resource as Record<string, unknown>)
					: undefined,
			spanAttrs,
		};
	}, [representativeMeta]);

	const borderColor = serviceColor.hex;

	const containerClass =
		variant === "inline"
			? "flex w-full flex-col border border-border bg-card rounded-lg overflow-hidden max-h-[420px]"
			: "flex w-[360px] shrink-0 flex-col border border-border bg-card rounded-lg overflow-hidden max-h-[70vh]";

	return (
		<div
			className={containerClass}
			style={{ borderLeftWidth: "3px", borderLeftColor: borderColor }}
		>
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
				<div className="flex items-center gap-2 min-w-0">
					<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${serviceColor.dot}`} />
					<div className="min-w-0">
						<span className="text-xs font-semibold truncate block">{span.service}</span>
						<span className="text-2xs text-muted-foreground truncate block">{span.name}</span>
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:scale-95"
					aria-label="Close span detail"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			{/* Scrollable content */}
			<div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
				{/* Attributes */}
				<SectionHeader>Attributes</SectionHeader>
				<div className="rounded-md border border-border/50 px-2.5 divide-y divide-border/30">
					<AttributeRow label="Span ID" value={span.spanId} mono />
					{span.parentSpanId && (
						<AttributeRow label="Parent Span ID" value={span.parentSpanId} mono />
					)}
					<AttributeRow label="Duration" value={formatDuration(span.duration)} />
					{span.start > 0 && (
						<AttributeRow label="Start offset" value={`+${formatDuration(span.start)}`} />
					)}
					<AttributeRow label="Level" value={<LevelBadge level={span.level as LogLevel} />} />
					{otelFields.kind && <AttributeRow label="Kind" value={otelFields.kind} />}
					{otelFields.statusCode !== undefined && (
						<AttributeRow
							label="Status"
							value={
								<span
									className={
										otelFields.statusCode === 2
											? "text-status-critical"
											: otelFields.statusCode === 1
												? "text-status-good"
												: "text-muted-foreground"
									}
								>
									{SPAN_STATUS_LABEL[otelFields.statusCode] ?? otelFields.statusCode}
								</span>
							}
						/>
					)}
					{otelFields.statusMessage && (
						<AttributeRow label="Status Msg" value={otelFields.statusMessage} />
					)}
					{otelFields.scope && <AttributeRow label="Scope" value={otelFields.scope} mono />}
				</div>

				{/* Span attributes (OTel) */}
				{Object.keys(otelFields.spanAttrs).length > 0 && (
					<>
						<SectionHeader>
							Span Attributes ({Object.keys(otelFields.spanAttrs).length})
						</SectionHeader>
						<div className="rounded-md border border-border/50 overflow-hidden">
							<JsonViewer data={otelFields.spanAttrs} className="!p-2 !text-2xs" />
						</div>
					</>
				)}

				{/* Resource attributes (OTel) */}
				{otelFields.resource && Object.keys(otelFields.resource).length > 0 && (
					<>
						<SectionHeader>Resource ({Object.keys(otelFields.resource).length})</SectionHeader>
						<div className="rounded-md border border-border/50 overflow-hidden">
							<JsonViewer data={otelFields.resource} className="!p-2 !text-2xs" />
						</div>
					</>
				)}

				{/* Span Logs */}
				<SectionHeader>Span Logs ({spanLogs.length})</SectionHeader>

				{spanLogs.length === 0 ? (
					<div className="rounded-md border border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
						No logs for this span
					</div>
				) : (
					<div className="rounded-md border border-border/50 overflow-hidden divide-y divide-border/30">
						{spanLogs.map((log) => {
							const meta = parseMeta(log.meta);
							return (
								<div key={log.id} className="px-2.5 py-1.5 space-y-1">
									<div className="flex items-center gap-2">
										<span className="shrink-0 text-2xs text-muted-foreground tabular-nums font-mono">
											{formatTime(log.timestamp)}
										</span>
										<LevelBadge level={log.level} />
										<span className="min-w-0 flex-1 truncate text-xs">{log.message}</span>
									</div>
									{meta && Object.keys(meta).length > 0 && (
										<div className="pl-1">
											<JsonViewer data={meta} className="!p-2 !text-2xs" />
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
