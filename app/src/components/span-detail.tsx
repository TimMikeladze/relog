import type { LogLevel, LogRecord, SpanBar } from "@/types";
import { LevelBadge } from "@/components/level-badge";
import { JsonViewer } from "@/components/json-viewer";
import { getServiceColor } from "@/components/service-colors";
import { X } from "lucide-react";
import { useMemo } from "react";

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

function formatTime(ts: string): string {
	try {
		const d = new Date(ts);
		return d.toLocaleTimeString("en-US", {
			hour12: false,
			fractionalSecondDigits: 3,
		});
	} catch {
		return ts;
	}
}

function formatDuration(ms: number): string {
	return `${ms.toLocaleString()}ms`;
}

const DOT_COLOR_MAP: Record<string, string> = {
	"bg-blue-400": "#60a5fa",
	"bg-emerald-400": "#34d399",
	"bg-violet-400": "#a78bfa",
	"bg-amber-400": "#fbbf24",
	"bg-cyan-400": "#22d3ee",
	"bg-pink-400": "#f472b6",
	"bg-lime-400": "#a3e635",
	"bg-orange-400": "#fb923c",
	"bg-teal-400": "#2dd4bf",
	"bg-indigo-400": "#818cf8",
};

function SectionHeader({ children }: { children: React.ReactNode }) {
	return (
		<div className="pt-3 pb-1.5">
			<span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
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
			<span className="shrink-0 text-[10px] text-muted-foreground/80 font-medium">{label}</span>
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

	const borderColor = DOT_COLOR_MAP[serviceColor.dot] ?? "#60a5fa";

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
						<span className="text-[10px] text-muted-foreground truncate block">
							{span.name}
						</span>
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
						<AttributeRow
							label="Level"
							value={<LevelBadge level={span.level as LogLevel} />}
						/>
					</div>

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
											<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums font-mono">
												{formatTime(log.timestamp)}
											</span>
											<LevelBadge level={log.level} />
											<span className="min-w-0 flex-1 truncate text-xs">
												{log.message}
											</span>
										</div>
										{meta && Object.keys(meta).length > 0 && (
											<div className="pl-1">
												<JsonViewer data={meta} className="!p-2 !text-[10px]" />
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
