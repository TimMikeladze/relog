import { Fragment, useState, useCallback } from "react";
import { getServiceColor } from "@/components/service-colors";
import type { SpanBar } from "@/types";

interface TraceWaterfallProps {
	spans: SpanBar[];
	selectedSpanId?: string;
	onSelectSpan?: (span: SpanBar) => void;
	inlineDetail?: (span: SpanBar) => React.ReactNode;
}

function formatDuration(ms: number): string {
	if (ms === 0) return "0ms";
	if (ms < 1) return "<1ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function computeTimeMarks(totalMs: number): number[] {
	if (totalMs <= 0) return [0];
	const targetCount = 5;
	const raw = totalMs / targetCount;
	const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
	const nice = [1, 2, 5, 10].find((n) => n * magnitude >= raw) ?? 10;
	const step = nice * magnitude;
	const marks: number[] = [0];
	let current = step;
	while (current < totalMs) {
		marks.push(current);
		current += step;
	}
	return marks;
}

function isErrorLevel(level: string): boolean {
	return level === "error" || level === "fatal";
}

const LEVEL_BADGE_COLORS: Record<string, string> = {
	trace: "bg-zinc-500/15 text-zinc-500 dark:bg-zinc-400/15 dark:text-zinc-400",
	debug: "bg-indigo-500/15 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-400",
	info: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-400",
	warn: "bg-amber-500/15 text-amber-600 dark:bg-amber-300/15 dark:text-amber-300",
	error: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
	fatal: "bg-pink-500/15 text-pink-600 dark:bg-pink-400/15 dark:text-pink-400",
};

interface TooltipState {
	span: SpanBar;
	x: number;
	y: number;
}

function SpanTooltip({ span, x, y }: TooltipState) {
	const badgeColor = LEVEL_BADGE_COLORS[span.level] ?? LEVEL_BADGE_COLORS.info;
	// Clamp to stay within viewport
	const left = Math.min(x + 12, window.innerWidth - 260);
	const top = Math.min(Math.max(y - 8, 8), window.innerHeight - 100);
	return (
		<div
			className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-lg"
			style={{ left, top }}
		>
			<div className="mb-1 font-medium text-foreground">{span.service}</div>
			<div className="mb-1.5 text-muted-foreground">{span.name}</div>
			<div className="flex items-center gap-3 text-[10px]">
				<span className="tabular-nums text-foreground">{formatDuration(span.duration)}</span>
				<span className="tabular-nums text-muted-foreground">+{formatDuration(span.start)}</span>
				<span
					className={`inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${badgeColor}`}
				>
					{span.level}
				</span>
			</div>
		</div>
	);
}

/**
 * Build a lookup: for each span, record whether it is the last child of its parent.
 * Also record ancestor "is last child" status for drawing vertical tree lines.
 */
function buildTreeConnectorInfo(spans: SpanBar[]): {
	isLastChild: Map<string, boolean>;
	parentIndex: Map<string, number>;
} {
	const isLastChild = new Map<string, boolean>();
	const parentIndex = new Map<string, number>();

	// Group children by parentSpanId
	const childrenOf = new Map<string, string[]>();
	const spanIndexById = new Map<string, number>();

	for (let i = 0; i < spans.length; i++) {
		const span = spans[i];
		spanIndexById.set(span.spanId, i);
		if (span.parentSpanId) {
			const siblings = childrenOf.get(span.parentSpanId) ?? [];
			siblings.push(span.spanId);
			childrenOf.set(span.parentSpanId, siblings);
		}
	}

	for (const [parentId, children] of childrenOf) {
		const pIdx = spanIndexById.get(parentId);
		if (pIdx !== undefined) {
			for (let c = 0; c < children.length; c++) {
				parentIndex.set(children[c], pIdx);
				isLastChild.set(children[c], c === children.length - 1);
			}
		}
	}

	return { isLastChild, parentIndex };
}

function TreeConnectors({
	span,
	spans,
	isLastChild,
	parentIndex,
}: {
	span: SpanBar;
	spans: SpanBar[];
	isLastChild: Map<string, boolean>;
	parentIndex: Map<string, number>;
}) {
	if (span.depth === 0) return null;

	const indentPx = 16;
	const elements: React.ReactNode[] = [];

	// For each ancestor depth level (1..depth-1), draw a vertical continuation line
	// if that ancestor is NOT the last child of its parent.
	let currentSpanId = span.spanId;
	const depthIsLast: boolean[] = [];

	// Walk up from current span to root, collecting "is last child" at each depth
	for (let d = span.depth; d >= 1; d--) {
		depthIsLast[d] = isLastChild.get(currentSpanId) ?? true;
		const pIdx = parentIndex.get(currentSpanId);
		if (pIdx !== undefined) {
			currentSpanId = spans[pIdx].spanId;
		}
	}

	// Draw vertical lines for ancestor depths where the ancestor is not the last child
	for (let d = 1; d < span.depth; d++) {
		if (!depthIsLast[d]) {
			elements.push(
				<div
					key={`vline-${d}`}
					className="absolute top-0 h-full border-l border-border/40"
					style={{ left: d * indentPx - indentPx / 2 }}
				/>,
			);
		}
	}

	// Draw the connector at the current depth: vertical line + horizontal tick
	const xPos = span.depth * indentPx - indentPx / 2;
	const isLast = isLastChild.get(span.spanId) ?? true;

	// Vertical line segment: full height if not last child, half height if last
	elements.push(
		<div
			key="vline-self"
			className="absolute top-0 border-l border-border/40"
			style={{
				left: xPos,
				height: isLast ? "50%" : "100%",
			}}
		/>,
	);

	// Horizontal tick
	elements.push(
		<div
			key="htick"
			className="absolute border-b border-border/40"
			style={{
				left: xPos,
				top: "50%",
				width: indentPx / 2,
			}}
		/>,
	);

	return (
		<div className="relative" style={{ width: span.depth * indentPx, minWidth: span.depth * indentPx }}>
			{elements}
		</div>
	);
}

const BAR_MIN_WIDTH_PX = 2;
const BAR_TEXT_THRESHOLD_PCT = 8;

export function TraceWaterfall({
	spans,
	selectedSpanId,
	onSelectSpan,
	inlineDetail,
}: TraceWaterfallProps) {
	const [tooltip, setTooltip] = useState<TooltipState | null>(null);

	const handleMouseEnter = useCallback((span: SpanBar, e: React.MouseEvent) => {
		setTooltip({ span, x: e.clientX, y: e.clientY });
	}, []);

	const handleMouseLeave = useCallback(() => {
		setTooltip(null);
	}, []);

	if (spans.length === 0) return null;

	const maxEnd = Math.max(...spans.map((s) => s.start + s.duration), 1);
	const timeMarks = computeTimeMarks(maxEnd);
	const { isLastChild, parentIndex } = buildTreeConnectorInfo(spans);

	return (
		<div className="relative w-full">
			{/* Time axis ruler */}
			<div className="flex items-end" style={{ height: 20 }}>
				<div className="shrink-0" style={{ width: 180 }} />
				<div className="relative flex-1">
					{timeMarks.map((ms) => {
						const leftPct = (ms / maxEnd) * 100;
						return (
							<span
								key={ms}
								className="absolute bottom-0 text-[9px] tabular-nums text-muted-foreground"
								style={{ left: `${leftPct}%`, transform: "translateX(-50%)" }}
							>
								{formatDuration(ms)}
							</span>
						);
					})}
				</div>
				<div className="shrink-0" style={{ width: 60 }} />
			</div>

			{/* Span rows */}
			<div className="relative">
				{/* Dashed vertical grid lines */}
				<div className="pointer-events-none absolute inset-0" style={{ left: 180, right: 60 }}>
					{timeMarks.map((ms) => {
						const leftPct = (ms / maxEnd) * 100;
						return (
							<div
								key={ms}
								className="absolute top-0 h-full border-l border-dashed border-border/30"
								style={{ left: `${leftPct}%` }}
							/>
						);
					})}
				</div>

				{spans.map((span, i) => {
					const leftPct = (span.start / maxEnd) * 100;
					const widthPct = Math.max((span.duration / maxEnd) * 100, 0.3);
					const isError = isErrorLevel(span.level);
					const color = getServiceColor(span.service);
					const barClass = isError ? "bg-red-500/80" : color.bar;
					const isSelected = span.spanId === selectedSpanId;
					const showTextInside = widthPct > BAR_TEXT_THRESHOLD_PCT;

					return (
						<Fragment key={span.spanId + "-" + i}>
						<div
							className={`flex cursor-pointer items-center transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none ${
								isSelected ? "bg-primary/10" : ""
							}`}
							style={{ height: 26 }}
							role="button"
							tabIndex={0}
							aria-label={`${span.service} ${span.name} ${formatDuration(span.duration)}`}
							onClick={() => onSelectSpan?.(span)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelectSpan?.(span);
								}
							}}
						>
							{/* Left column: tree connectors + service/span name */}
							<div
								className="flex shrink-0 items-center overflow-hidden"
								style={{ width: 180 }}
							>
								<TreeConnectors
									span={span}
									spans={spans}
									isLastChild={isLastChild}
									parentIndex={parentIndex}
								/>
								<span className={`min-w-0 truncate text-[10px] font-medium pr-2 ${color.label}`}>
									{span.service}
								</span>
							</div>

							{/* Timeline bar area */}
							<div className="relative flex-1 self-stretch">
								<div className="absolute inset-0 bg-muted/30" />
								<div
									className={`absolute top-1 bottom-1 flex items-center rounded px-1 ${barClass}`}
									style={{
										left: `${leftPct}%`,
										width: `${widthPct}%`,
										minWidth: BAR_MIN_WIDTH_PX,
									}}
									onMouseEnter={(e) => handleMouseEnter(span, e)}
									onMouseLeave={handleMouseLeave}
								>
									{showTextInside && (
										<span className="truncate text-[9px] font-medium text-white">
											{span.name}
										</span>
									)}
								</div>

								{/* Span name outside bar when bar is too narrow */}
								{!showTextInside && (
									<span
										className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground"
										style={{
											left: `calc(${leftPct + widthPct}% + 4px)`,
											maxWidth: `calc(${100 - leftPct - widthPct}% - 8px)`,
										}}
									>
										{span.name}
									</span>
								)}
							</div>

							{/* Duration label */}
							<div className="shrink-0 text-right" style={{ width: 60 }}>
								<span className="text-[10px] tabular-nums text-muted-foreground">
									{formatDuration(span.duration)}
								</span>
							</div>
						</div>
						{isSelected && inlineDetail && (
							<div className="relative z-10 px-2 py-2 bg-background">
								{inlineDetail(span)}
							</div>
						)}
						</Fragment>
					);
				})}
			</div>

			{/* Tooltip */}
			{tooltip && <SpanTooltip {...tooltip} />}
		</div>
	);
}
