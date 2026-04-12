import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHashParam } from "@/hooks/use-hash-param";
import { apiPost } from "@/api/client";
import { useStream } from "@/hooks/use-stream";
import { TimelineChart, HoverStats } from "@/components/timeline-chart";
import { LevelBadge } from "@/components/level-badge";
import type { Filters, LogRecord, QueryResult } from "@/types";

import {
	ChevronRight,
	ChevronDown,
	Circle,
	Pause,
	Play,
	Radio,
	Trash2,
	Bookmark,
	BookmarkCheck,
} from "lucide-react";
import { useBookmarks } from "@/hooks/use-bookmarks";

interface TraceRow {
	trace_id: string;
	first_ts: string;
	span_count: number;
	duration_ms: number;
	max_level: string;
	services: string;
}

interface SpanBar {
	name: string;
	service: string;
	spanId: string;
	parentSpanId?: string;
	start: number;
	duration: number;
	level: string;
	depth: number;
}

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
		// Prevent self-referencing spans
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
	const raw: Omit<SpanBar, "depth">[] = [];

	// Prefer logs that have duration_ms (OTEL spans or wide events)
	const spansWithDuration = logs.filter(
		(l) => l.duration_ms != null || parseMeta(l).duration_ms != null,
	);

	if (spansWithDuration.length > 0) {
		const baseTime = Math.min(
			...spansWithDuration.map((l) => new Date(l.timestamp).getTime()),
		);
		for (const log of spansWithDuration) {
			const meta = parseMeta(log);
			const durationMs = Number(log.duration_ms ?? meta.duration_ms) || 1;
			raw.push({
				name: log.message,
				service: log.service || "unknown",
				spanId: log.span_id || String(log.id),
				parentSpanId: log.parent_span_id || undefined,
				start: Math.max(0, new Date(log.timestamp).getTime() - baseTime),
				duration: durationMs,
				level: log.level,
			});
		}
	} else {
		const baseTime = new Date(logs[0].timestamp).getTime();
		// Fallback: group by span_id or service
		const spanGroups = new Map<string, LogRecord[]>();
		for (const l of logs) {
			const key = l.span_id || l.service || "unknown";
			if (!spanGroups.has(key)) spanGroups.set(key, []);
			spanGroups.get(key)!.push(l);
		}
		for (const [key, group] of spanGroups) {
			const start = new Date(group[0].timestamp).getTime() - baseTime;
			const end = new Date(group[group.length - 1].timestamp).getTime() - baseTime;
			const maxLevel = group.reduce(
				(max, l) => (levelPriority(l.level) > levelPriority(max) ? l.level : max),
				"info",
			);
			raw.push({
				name: key,
				service: group[0].service || "unknown",
				spanId: key,
				parentSpanId: undefined,
				start,
				duration: Math.max(end - start, 1),
				level: maxLevel,
			});
		}
	}

	// If any spans have parent_span_id, build a tree; otherwise flat with depth 0
	const hasTree = raw.some((s) => s.parentSpanId);
	if (hasTree) return flattenTree(raw);
	return raw.map((s) => ({ ...s, depth: 0 }));
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
			// Prefer the column, fall back to meta
			const d = l.duration_ms ?? parseMeta(l).duration_ms;
			if (d != null) durationMs = Math.max(durationMs, Number(d));
		}
		const services = [...new Set(group.map((l) => l.service).filter(Boolean))].join(",");
		rows.push({
			trace_id: traceId,
			first_ts: group[0].timestamp,
			span_count: spanIds.size,
			duration_ms: durationMs,
			max_level: maxLevel,
			services,
		});
	}

	rows.sort((a, b) => new Date(b.first_ts).getTime() - new Date(a.first_ts).getTime());
	return rows;
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
	const [live, setLive] = useHashParam("live");

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

		let where = "WHERE trace_id IS NOT NULL AND trace_id != ''";
		const inClause = (col: string, val?: string) => {
			if (!val) return;
			const vals = val.split(",").map((v) => `'${v.replace(/'/g, "''")}'`);
			where +=
				vals.length === 1 ? ` AND ${col} = ${vals[0]}` : ` AND ${col} IN (${vals.join(", ")})`;
		};
		inClause("trace_id", filters.trace_id);
		inClause("service", filters.service);
		inClause("project", filters.project);
		inClause("branch", filters.branch);
		inClause("version", filters.version);
		inClause("deployment_id", filters.deployment_id);
		inClause("level", filters.level);
		if (filters.grep) {
			const escaped = filters.grep.replace(/'/g, "''").replace(/[%_\\]/g, "\\$&");
			where += ` AND message LIKE '%${escaped}%' ESCAPE '\\'`;
		}
		if (filters.from) {
			const match = filters.from.match(/^(\d+)([smhdwMy])$/);
			if (match) {
				const ms: Record<string, number> = {
					s: 1000,
					m: 60_000,
					h: 3600_000,
					d: 86400_000,
					w: 604_800_000,
					M: 2_592_000_000,
					y: 31_536_000_000,
				};
				where += ` AND created_at > ${Date.now() - parseInt(match[1]) * (ms[match[2]] ?? 3600_000)}`;
			}
		}

		const sql = `
      SELECT
        trace_id,
        MIN(timestamp) as first_ts,
        COUNT(DISTINCT COALESCE(span_id, CAST(id AS VARCHAR))) as span_count,
        COALESCE(MAX(duration_ms), 0) as duration_ms,
        MAX(CASE
          WHEN level = 'fatal' THEN 5
          WHEN level = 'error' THEN 4
          WHEN level = 'warn' THEN 3
          ELSE 2
        END) as max_level_num,
        CASE MAX(CASE
          WHEN level = 'fatal' THEN 5
          WHEN level = 'error' THEN 4
          WHEN level = 'warn' THEN 3
          ELSE 2
        END)
          WHEN 5 THEN 'fatal'
          WHEN 4 THEN 'error'
          WHEN 3 THEN 'warn'
          ELSE 'info'
        END as max_level,
        STRING_AGG(DISTINCT service, ',') as services
      FROM logs
      ${where}
      GROUP BY trace_id
      ORDER BY MIN(created_at) DESC
      LIMIT 100
    `;

		apiPost<QueryResult>("/query", { sql })
			.then((res) => {
				setTraces(
					res.rows.map((r) => ({
						trace_id: r.trace_id as string,
						first_ts: r.first_ts as string,
						span_count: Number(r.span_count),
						duration_ms: Number(r.duration_ms),
						max_level: r.max_level as string,
						services: (r.services as string) || "",
					})),
				);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [enabled, live, filters]);

	const expandTrace = useCallback(
		(traceId: string) => {
			setExpandedTrace(expandedTrace === traceId ? undefined : traceId);
		},
		[expandedTrace],
	);

	// Fetch trace logs whenever expandedTrace changes (covers both user clicks and URL restore).
	// Always clear first to avoid showing stale logs from a previously expanded trace.
	useEffect(() => {
		setTraceLogs([]);
		setTraceSpans([]);
		if (!expandedTrace || live === "1" || !enabled) return;
		// Sanitize trace_id: allow hex, dashes, colons, alphanumeric (covers OTEL hex + gha:123 patterns)
		if (!/^[\w:.-]{1,256}$/.test(expandedTrace)) return;
		const safe = expandedTrace.replace(/'/g, "''");
		const sql = `SELECT * FROM logs WHERE trace_id = '${safe}' ORDER BY created_at ASC LIMIT 200`;
		apiPost<QueryResult>("/query", { sql })
			.then((res) => {
				const logs = res.rows as unknown as LogRecord[];
				setTraceLogs(logs);
				setTraceSpans(buildSpans(logs));
			})
			.catch(() => {
				setTraceLogs([]);
				setTraceSpans([]);
			});
	}, [expandedTrace, live, enabled]);

	const statusDot = (level: string) => {
		const colors: Record<string, string> = {
			fatal: "bg-pink-400/75",
			error: "bg-rose-400/75",
			warn: "bg-amber-300/75",
			info: "bg-cyan-400/75",
		};
		return colors[level] || colors.info;
	};

	const allTraces = live === "1" ? liveTraces : traces;
	const displayTraces =
		filters.bookmarked === "true"
			? allTraces.filter((t) => isBookmarked(`trace:${t.trace_id}`))
			: allTraces;
	const displayTraceLogs = live === "1" ? liveTraceLogs : traceLogs;
	const displayTraceSpans = live === "1" ? liveTraceSpans : traceSpans;

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
			>
				{(hoverBucket) => (
					<>
						<button
							type="button"
							onClick={() => setLive(live === "1" ? undefined : "1")}
							className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
								live === "1"
									? "bg-emerald-500/15 text-emerald-500"
									: "text-muted-foreground hover:bg-muted hover:text-foreground"
							}`}
						>
							<Radio className="h-3 w-3" />
							Live
						</button>

						{live === "1" && (
							<>
								<div className="h-3 w-px bg-border" />
								<div className="flex items-center gap-1.5">
									<Circle
										className={`h-2 w-2 ${stream.connected ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
									/>
									<span className="text-[10px] text-muted-foreground">
										{stream.connected ? "Connected" : stream.paused ? "Paused" : "Disconnected"}
									</span>
								</div>
								<span className="text-[10px] text-muted-foreground tabular-nums">
									{liveTraces.length} traces / {stream.logs.length.toLocaleString()} events
								</span>
							</>
						)}

						{live !== "1" && loading && (
							<span className="text-[10px] text-muted-foreground">Loading...</span>
						)}
						{live !== "1" && !loading && (
							<span className="text-[10px] text-muted-foreground">{traces.length} traces</span>
						)}

						<HoverStats bucket={hoverBucket} />

						<div className="flex-1" />

						{live === "1" && (
							<>
								<button
									type="button"
									onClick={stream.clear}
									className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									<Trash2 className="h-3 w-3" />
									Clear
								</button>
								<button
									type="button"
									onClick={stream.paused ? stream.resume : stream.pause}
									className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									{stream.paused ? (
										<>
											<Play className="h-3 w-3" />
											Resume
										</>
									) : (
										<>
											<Pause className="h-3 w-3" />
											Pause
										</>
									)}
								</button>
							</>
						)}
					</>
				)}
			</TimelineChart>
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
				<div className="divide-y divide-border/50">
					{displayTraces.map((t) => (
						<div key={t.trace_id}>
							<div className="group flex w-full items-center hover:bg-muted/50">
								<button
									type="button"
									onClick={() => expandTrace(t.trace_id)}
									className="flex flex-1 items-center gap-3 px-4 py-2 text-left text-xs"
								>
									{expandedTrace === t.trace_id ? (
										<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
									) : (
										<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
									)}
									<span className="w-32 shrink-0 truncate text-primary">{t.trace_id}</span>
									<span className="w-24 shrink-0 text-muted-foreground tabular-nums">
										{new Date(t.first_ts).toLocaleTimeString("en-US", { hour12: false })}
									</span>
									<span className="w-16 shrink-0 tabular-nums">{t.span_count} spans</span>
									<span className="w-20 shrink-0 tabular-nums">
										{t.duration_ms > 0 ? `${Math.round(t.duration_ms)}ms` : "\u2014"}
									</span>
									<span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(t.max_level)}`} />
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{t.services}
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
									className={`mr-2 shrink-0 rounded p-0.5 transition-colors ${isBookmarked(`trace:${t.trace_id}`) ? "text-amber-400" : "text-transparent group-hover:text-muted-foreground hover:!text-amber-400"}`}
								>
									{isBookmarked(`trace:${t.trace_id}`) ? (
										<BookmarkCheck className="h-3 w-3" />
									) : (
										<Bookmark className="h-3 w-3" />
									)}
								</button>
							</div>

							{expandedTrace === t.trace_id && (
								<div className="border-t border-border/50 bg-muted/20 px-4 py-4 space-y-4">
									{/* Waterfall */}
									{displayTraceSpans.length > 0 && (() => {
									const maxEnd = Math.max(
										...displayTraceSpans.map((s) => s.start + s.duration),
										1,
									);
									return (
										<div>
											<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
												Waterfall
											</div>
											<div className="space-y-0.5">
												{displayTraceSpans.map((span, i) => {
													const leftPct = (span.start / maxEnd) * 100;
													const widthPct = Math.max((span.duration / maxEnd) * 100, 0.5);
													const isError = levelPriority(span.level) >= 4;
													const indent = span.depth * 12;
													return (
														<div key={i} className="flex items-center gap-2">
															<span
																className="shrink-0 truncate text-[10px] text-muted-foreground"
																style={{
																	width: `${96 + indent}px`,
																	paddingLeft: `${indent}px`,
																}}
															>
																{span.depth > 0 && (
																	<span className="text-border mr-1">{"└"}</span>
																)}
																{span.service}
															</span>
															<div className="relative h-5 flex-1 rounded bg-muted/30">
																<div
																	className={`absolute top-0 h-full rounded text-[9px] flex items-center px-1 text-white font-medium truncate ${isError ? "bg-red-500/80" : "bg-primary/60"}`}
																	style={{
																		left: `${leftPct}%`,
																		width: `${widthPct}%`,
																		minWidth: "2px",
																	}}
																>
																	{widthPct > 8 ? span.name : ""}
																</div>
															</div>
															<span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
																{Math.round(span.duration)}ms
															</span>
														</div>
													);
												})}
											</div>
										</div>
									);
								})()}

									{/* Trace logs */}
									<div>
										<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
											Logs ({displayTraceLogs.length})
										</div>
										<div className="rounded-md border border-border overflow-hidden divide-y divide-border/50">
											{displayTraceLogs.map((l) => (
												<div key={l.id} className="flex items-center gap-3 px-3 py-1 text-xs">
													<span className="shrink-0 text-muted-foreground tabular-nums">
														{new Date(l.timestamp).toLocaleTimeString("en-US", {
															hour12: false,
															fractionalSecondDigits: 3,
														})}
													</span>
													<LevelBadge level={l.level} />
													{l.service && (
														<span className="shrink-0 text-muted-foreground">{l.service}</span>
													)}
													<span className="min-w-0 flex-1 truncate">{l.message}</span>
												</div>
											))}
										</div>
									</div>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
