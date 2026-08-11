import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { apiGet } from "@/api/client";
import { useStream } from "@/hooks/use-stream";
import { TimelineChart } from "@/components/timeline-chart";
import {
	LIVE_ACTIVE_CLASS,
	ToolbarButton,
	ToolbarSegment,
	ToolbarSegments,
} from "@/components/layout/toolbar";
import { LevelBadge } from "@/components/level-badge";
import { formatClockTime as formatTimestamp } from "@/lib/format-time";
import { TraceWaterfall } from "@/components/trace-waterfall";
import { SpanDetail } from "@/components/span-detail";
import { getServiceColor } from "@/components/service-colors";
import type { Filters, LogRecord, SpanBar } from "@/types";

import {
	ChevronRight,
	ChevronDown,
	Pause,
	Play,
	Radio,
	Trash2,
	Bookmark,
	BookmarkCheck,
	ArrowUpDown,
	AlignLeft,
	PanelRight,
} from "lucide-react";
import { useBookmarks } from "@/hooks/use-bookmarks";

interface TraceRow {
	trace_id: string;
	first_ts: string;
	span_count: number;
	duration_ms: number;
	max_level: string;
	services: string;
	root_message: string;
}

type SortField = "time" | "duration" | "spans";

function levelPriority(level: string): number {
	return (
		({ trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 } as Record<string, number>)[
			level
		] ?? 2
	);
}

function parseMeta(log: LogRecord): Record<string, unknown> {
	try {
		return typeof log.meta === "string" ? JSON.parse(log.meta || "{}") : log.meta || {};
	} catch {
		return {};
	}
}

function flattenTree(nodes: Omit<SpanBar, "depth">[]): SpanBar[] {
	type TreeNode = Omit<SpanBar, "depth"> & { children: TreeNode[] };
	const byId = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];

	for (const node of nodes) {
		byId.set(node.spanId, { ...node, children: [] });
	}

	for (const node of byId.values()) {
		if (node.parentSpanId && node.parentSpanId !== node.spanId && byId.has(node.parentSpanId)) {
			byId.get(node.parentSpanId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const result: SpanBar[] = [];
	const visited = new Set<string>();
	function walk(n: TreeNode, depth: number) {
		if (visited.has(n.spanId)) return;
		visited.add(n.spanId);
		result.push({ ...n, depth });
		n.children.sort((a, b) => a.start - b.start);
		for (const child of n.children) walk(child, depth + 1);
	}
	roots.sort((a, b) => a.start - b.start);
	for (const root of roots) walk(root, 0);
	return result;
}

function buildSpans(logs: LogRecord[]): SpanBar[] {
	if (logs.length === 0) return [];

	// Base time = earliest log in the trace (not just ones with duration)
	const baseTime = Math.min(...logs.map((l) => new Date(l.timestamp).getTime()));

	// Group logs by span_id so each span becomes one bar, regardless of how many logs it has.
	// Logs without a span_id get a synthetic unique key so they don't collapse together.
	const spanGroups = new Map<string, LogRecord[]>();
	for (const log of logs) {
		const key = log.span_id || `__log_${log.id}`;
		if (!spanGroups.has(key)) spanGroups.set(key, []);
		spanGroups.get(key)!.push(log);
	}

	const raw: Omit<SpanBar, "depth">[] = [];
	for (const [spanId, group] of spanGroups) {
		group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

		// Prefer a log with duration_ms for the span's representative info
		const durationLog = group.find(
			(l) => l.duration_ms != null || parseMeta(l).duration_ms != null,
		);
		const representative = durationLog ?? group[0];
		const meta = parseMeta(representative);
		const explicitDuration = Number(representative.duration_ms ?? meta.duration_ms);

		const startMs = new Date(group[0].timestamp).getTime() - baseTime;
		let durationMs: number;
		if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
			durationMs = explicitDuration;
		} else if (group.length > 1) {
			const endMs = new Date(group[group.length - 1].timestamp).getTime() - baseTime;
			durationMs = Math.max(endMs - startMs, 1);
		} else {
			// Single point-in-time log with no duration: treat as 1ms marker
			durationMs = 1;
		}

		const maxLevel = group.reduce(
			(max, l) => (levelPriority(l.level) > levelPriority(max) ? l.level : max),
			"info",
		);

		const kind = typeof meta.span_kind === "string" ? meta.span_kind : undefined;
		const statusCode =
			typeof meta.span_status_code === "number" ? meta.span_status_code : undefined;

		raw.push({
			name: representative.message,
			service: representative.service || "unknown",
			spanId: spanId.startsWith("__log_") ? String(representative.id) : spanId,
			parentSpanId: representative.parent_span_id || undefined,
			start: Math.max(0, startMs),
			duration: durationMs,
			level: maxLevel,
			kind,
			statusCode,
		});
	}

	const hasTree = raw.some((s) => s.parentSpanId);
	if (hasTree) return flattenTree(raw);
	return raw.map((s) => ({ ...s, depth: 0 })).sort((a, b) => a.start - b.start);
}

function logsToTraceRows(logs: LogRecord[]): TraceRow[] {
	const groups = new Map<string, LogRecord[]>();
	for (const log of logs) {
		if (!log.trace_id) continue;
		if (!groups.has(log.trace_id)) groups.set(log.trace_id, []);
		groups.get(log.trace_id)!.push(log);
	}

	const rows: TraceRow[] = [];
	for (const [traceId, group] of groups) {
		group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
		const spanIds = new Set(group.map((l) => l.span_id || String(l.id)));
		const maxLevel = group.reduce(
			(max, l) => (levelPriority(l.level) > levelPriority(max) ? l.level : max),
			"info",
		);
		let durationMs = 0;
		for (const l of group) {
			const d = l.duration_ms ?? parseMeta(l).duration_ms;
			if (d != null) durationMs = Math.max(durationMs, Number(d));
		}
		const services = [...new Set(group.map((l) => l.service).filter(Boolean))].join(",");
		// Use first log's message as root message
		const rootMessage = group[0].message;
		rows.push({
			trace_id: traceId,
			first_ts: group[0].timestamp,
			span_count: spanIds.size,
			duration_ms: durationMs,
			max_level: maxLevel,
			services,
			root_message: rootMessage,
		});
	}

	rows.sort((a, b) => new Date(b.first_ts).getTime() - new Date(a.first_ts).getTime());
	return rows;
}

function truncateId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function sortTraces(traces: TraceRow[], field: SortField): TraceRow[] {
	const sorted = [...traces];
	switch (field) {
		case "duration":
			sorted.sort((a, b) => b.duration_ms - a.duration_ms);
			break;
		case "spans":
			sorted.sort((a, b) => b.span_count - a.span_count);
			break;
		case "time":
		default:
			sorted.sort((a, b) => new Date(b.first_ts).getTime() - new Date(a.first_ts).getTime());
			break;
	}
	return sorted;
}

export function TracesView({
	filters,
	enabled,
	onUpdateFilters,
}: {
	filters: Filters;
	enabled: boolean;
	onUpdateFilters: (updates: Partial<Filters>) => void;
}) {
	const { toggle, isBookmarked } = useBookmarks();
	const [traces, setTraces] = useState<TraceRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [expandedTrace, setExpandedTrace] = useHashParam("expanded");
	const [traceLogs, setTraceLogs] = useState<LogRecord[]>([]);
	const [traceSpans, setTraceSpans] = useState<SpanBar[]>([]);
	const [traceLogsLoading, setTraceLogsLoading] = useState(false);
	const [live, setLive] = useHashParam("live");
	const [detailMode, setDetailMode] = useHashParam("detail", "panel");
	const [sortField, setSortField] = useState<SortField>("time");
	const [selectedSpan, setSelectedSpan] = useState<SpanBar | null>(null);

	const stream = useStream(filters, enabled && live === "1");

	const liveTraces = useMemo(() => logsToTraceRows(stream.logs), [stream.logs]);
	const liveTraceLogs = useMemo(() => {
		if (live !== "1" || !expandedTrace) return [];
		return stream.logs
			.filter((l) => l.trace_id === expandedTrace)
			.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	}, [live, expandedTrace, stream.logs]);
	const liveTraceSpans = useMemo(() => buildSpans(liveTraceLogs), [liveTraceLogs]);

	const [refreshKey, setRefreshKey] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

	useEffect(() => {
		if (live !== "1") return;
		intervalRef.current = setInterval(() => setRefreshKey((k) => k + 1), 10_000);
		return () => clearInterval(intervalRef.current);
	}, [live]);

	useEffect(() => {
		if (!enabled || live === "1") return;
		setLoading(true);

		const params: Record<string, string> = { limit: "100" };
		if (filters.trace_id) params.trace_id = filters.trace_id;
		if (filters.service) params.service = filters.service;
		if (filters.project) params.project = filters.project;
		if (filters.branch) params.branch = filters.branch;
		if (filters.version) params.version = filters.version;
		if (filters.deployment_id) params.deployment_id = filters.deployment_id;
		if (filters.level) params.level = filters.level;
		if (filters.grep) params.grep = filters.grep;
		if (filters.from) params.from = filters.from;
		if (filters.to) params.to = filters.to;

		apiGet<{ rows: TraceRow[] }>("/traces", params)
			.then((res) => {
				setTraces(
					res.rows.map((r) => ({
						trace_id: r.trace_id,
						first_ts: r.first_ts,
						span_count: Number(r.span_count),
						duration_ms: Number(r.duration_ms),
						max_level: r.max_level,
						services: r.services || "",
						root_message: r.root_message || "",
					})),
				);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [enabled, live, filters]);

	const expandTrace = useCallback(
		(traceId: string) => {
			setSelectedSpan(null);
			setExpandedTrace(expandedTrace === traceId ? undefined : traceId);
		},
		[expandedTrace],
	);

	useEffect(() => {
		setTraceLogs([]);
		setTraceSpans([]);
		setSelectedSpan(null);
		if (!expandedTrace || live === "1" || !enabled) return;
		if (!/^[\w:.-]{1,256}$/.test(expandedTrace)) return;
		setTraceLogsLoading(true);
		apiGet<{ rows: LogRecord[] }>("/logs", {
			trace_id: expandedTrace,
			limit: "200",
		})
			.then((res) => {
				const logs = [...res.rows].sort(
					(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
				);
				setTraceLogs(logs);
				setTraceSpans(buildSpans(logs));
			})
			.catch(() => {
				setTraceLogs([]);
				setTraceSpans([]);
			})
			.finally(() => setTraceLogsLoading(false));
	}, [expandedTrace, live, enabled]);

	const allTraces = live === "1" ? liveTraces : traces;
	const sortedTraces = useMemo(() => sortTraces(allTraces, sortField), [allTraces, sortField]);
	const displayTraces =
		filters.bookmarked === "true"
			? sortedTraces.filter((t) => isBookmarked(`trace:${t.trace_id}`))
			: sortedTraces;
	const displayTraceLogs = live === "1" ? liveTraceLogs : traceLogs;
	const displayTraceSpans = live === "1" ? liveTraceSpans : traceSpans;

	const cycleSortField = useCallback(() => {
		setSortField((prev) => {
			const order: SortField[] = ["time", "duration", "spans"];
			return order[(order.indexOf(prev) + 1) % order.length]!;
		});
	}, []);

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineChart
				from={live === "1" ? "15m" : filters.from || "1h"}
				to={live === "1" ? undefined : filters.to}
				filters={filters as Record<string, string | undefined>}
				refreshKey={live === "1" ? refreshKey : undefined}
				onTimeRangeSelect={live === "1" ? undefined : (from, to) => onUpdateFilters({ from, to })}
				onResetTimeRange={
					live !== "1" ? () => onUpdateFilters({ from: undefined, to: undefined }) : undefined
				}
				leading={
					<>
						<ToolbarButton
							onClick={() => setLive(live === "1" ? undefined : "1")}
							active={live === "1"}
							activeClassName={LIVE_ACTIVE_CLASS}
							icon={Radio}
						>
							Live
						</ToolbarButton>

						<span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
							{live === "1"
								? stream.paused
									? "Paused"
									: stream.connected
										? `${liveTraces.length} traces · ${stream.logs.length.toLocaleString()} events`
										: "Disconnected"
								: loading
									? "Loading…"
									: `${traces.length} ${traces.length === 1 ? "trace" : "traces"}`}
						</span>
					</>
				}
				trailing={
					<>
						<ToolbarButton
							onClick={cycleSortField}
							icon={ArrowUpDown}
							title={`Sorting by ${sortField} — click to cycle`}
						>
							{sortField === "time"
								? "Newest"
								: sortField === "duration"
									? "Slowest"
									: "Most spans"}
						</ToolbarButton>

						{live === "1" && (
							<>
								<ToolbarButton onClick={stream.clear} icon={Trash2}>
									Clear
								</ToolbarButton>
								<ToolbarButton
									onClick={stream.paused ? stream.resume : stream.pause}
									icon={stream.paused ? Play : Pause}
								>
									{stream.paused ? "Resume" : "Pause"}
								</ToolbarButton>
							</>
						)}

						<div className="mx-0.5 h-3 w-px shrink-0 bg-border" />

						<ToolbarSegments>
							<ToolbarSegment
								active={detailMode === "inline"}
								onClick={() => setDetailMode("inline")}
								title="Expand details inline"
								icon={AlignLeft}
							/>
							<ToolbarSegment
								active={detailMode === "panel"}
								onClick={() => setDetailMode("panel")}
								title="Show details in a side panel"
								icon={PanelRight}
							/>
						</ToolbarSegments>
					</>
				}
			/>
			<div className="flex-1 overflow-y-auto">
				{live !== "1" && loading && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						Loading traces...
					</div>
				)}
				{!loading && displayTraces.length === 0 && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						{live === "1"
							? stream.connected
								? "Waiting for traces..."
								: "Not connected"
							: "No traces found. Logs need a trace_id to appear here."}
					</div>
				)}
				{/* Column headers, matching Explore. Without them the right-hand
				    columns were three unlabeled numbers per row. */}
				<div className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-1.5 text-2xs font-medium text-muted-foreground">
					<span className="w-3 shrink-0" />
					<span className="w-12 shrink-0">Level</span>
					<span className="min-w-0 flex-1">Trace</span>
					<span className="shrink-0">Services</span>
					<span className="w-16 shrink-0 text-right">Spans</span>
					<span className="w-20 shrink-0 text-right">Duration</span>
					<span className="w-24 shrink-0 text-right">Started</span>
					<span className="mr-2 w-3 shrink-0" />
				</div>
				<div className="divide-y divide-border/50">
					{displayTraces.map((t) => {
						const serviceList = t.services.split(",").filter(Boolean);
						const isExpanded = expandedTrace === t.trace_id;
						return (
							<div key={t.trace_id}>
								<div className="group flex w-full items-center hover:bg-muted/50">
									<button
										type="button"
										onClick={() => expandTrace(t.trace_id)}
										className="flex flex-1 items-center gap-3 px-4 py-2.5 text-left text-xs"
									>
										{isExpanded ? (
											<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
										) : (
											<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
										)}

										{/* Level indicator */}
										<LevelBadge
											level={t.max_level as "trace" | "debug" | "info" | "warn" | "error" | "fatal"}
											className="w-12 justify-center"
										/>

										{/* Root message + truncated ID */}
										<div className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="truncate font-medium text-foreground">
												{t.root_message || truncateId(t.trace_id)}
											</span>
											<span className="truncate font-mono text-2xs text-muted-foreground/60">
												{truncateId(t.trace_id)}
											</span>
										</div>

										{/* Services as colored dots */}
										<div className="flex shrink-0 items-center gap-1">
											{serviceList.slice(0, 4).map((svc) => (
												<span
													key={svc}
													className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs ring-1 ring-inset ${getServiceColor(svc).chip}`}
													title={svc}
												>
													{svc}
												</span>
											))}
											{serviceList.length > 4 && (
												<span className="text-2xs text-muted-foreground">
													+{serviceList.length - 4}
												</span>
											)}
										</div>

										{/* Span count */}
										<span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
											{t.span_count} {t.span_count === 1 ? "span" : "spans"}
										</span>

										{/* Duration */}
										<span className="w-20 shrink-0 text-right tabular-nums">
											{t.duration_ms > 0 ? `${Math.round(t.duration_ms)}ms` : "\u2014"}
										</span>

										{/* Timestamp with sub-second precision */}
										<span className="w-24 shrink-0 text-right font-mono text-2xs text-muted-foreground tabular-nums">
											{formatTimestamp(t.first_ts)}
										</span>
									</button>
									<button
										type="button"
										onClick={() =>
											toggle({
												type: "trace",
												label: t.trace_id,
												timestamp: t.first_ts,
												level: t.max_level,
												traceId: t.trace_id,
											})
										}
										className={`mr-2 shrink-0 rounded p-0.5 transition-colors ${isBookmarked(`trace:${t.trace_id}`) ? "text-primary" : "text-transparent group-hover:text-muted-foreground hover:!text-primary"}`}
									>
										{isBookmarked(`trace:${t.trace_id}`) ? (
											<BookmarkCheck className="h-3 w-3" />
										) : (
											<Bookmark className="h-3 w-3" />
										)}
									</button>
								</div>

								{isExpanded && (
									<div className="border-t border-border/50 bg-muted/20 px-4 py-4 space-y-4">
										{/* Waterfall + Span Detail side by side */}
										<div className="flex gap-3">
											<div className="min-w-0 flex-1">
												{displayTraceSpans.length > 0 && (
													<div>
														<div className="mb-2 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
															Waterfall
														</div>
														<TraceWaterfall
															spans={displayTraceSpans}
															selectedSpanId={selectedSpan?.spanId}
															onSelectSpan={setSelectedSpan}
															inlineDetail={
																detailMode === "inline"
																	? (span) => (
																			<SpanDetail
																				span={span}
																				logs={displayTraceLogs}
																				onClose={() => setSelectedSpan(null)}
																				variant="inline"
																			/>
																		)
																	: undefined
															}
														/>
													</div>
												)}

												{/* Trace logs */}
												<div className={displayTraceSpans.length > 0 ? "mt-4" : ""}>
													<div className="mb-2 text-2xs font-medium text-muted-foreground uppercase tracking-wider">
														Logs ({displayTraceLogs.length})
													</div>
													<div className="rounded-md border border-border overflow-hidden divide-y divide-border/50">
														{displayTraceLogs.length === 0 && (
															<div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
																{traceLogsLoading ? "Loading logs..." : "No logs for this trace"}
															</div>
														)}
														{displayTraceLogs.map((l) => (
															<div
																key={l.id}
																className={`flex cursor-pointer items-center gap-3 px-3 py-1 text-xs transition-colors ${
																	selectedSpan && l.span_id === selectedSpan.spanId
																		? "bg-primary/10"
																		: "hover:bg-muted/30"
																}`}
																onClick={() => {
																	if (!l.span_id) return;
																	const match = displayTraceSpans.find(
																		(s) => s.spanId === l.span_id,
																	);
																	if (match) setSelectedSpan(match);
																}}
															>
																<span className="shrink-0 text-muted-foreground tabular-nums font-mono text-2xs">
																	{formatTimestamp(l.timestamp)}
																</span>
																<LevelBadge level={l.level} />
																{l.service && (
																	<span
																		className={`shrink-0 text-2xs ${getServiceColor(l.service).label}`}
																	>
																		{l.service}
																	</span>
																)}
																<span className="min-w-0 flex-1 truncate">{l.message}</span>
																{l.span_id && (
																	<span className="shrink-0 font-mono text-2xs text-muted-foreground/40">
																		{l.span_id.slice(0, 8)}
																	</span>
																)}
															</div>
														))}
													</div>
												</div>
											</div>

											{/* Span detail panel */}
											{detailMode === "panel" && selectedSpan && (
												<SpanDetail
													span={selectedSpan}
													logs={displayTraceLogs}
													onClose={() => setSelectedSpan(null)}
												/>
											)}
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
