import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/api/client";
import { TimelineStrip } from "@/components/timeline-strip";
import { LevelBadge } from "@/components/level-badge";
import type { Filters, LogRecord, QueryResult } from "@/types";

import { ChevronRight, ChevronDown } from "lucide-react";

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
	start: number;
	duration: number;
	level: string;
}

function levelPriority(level: string): number {
	return (
		({ trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5 } as Record<string, number>)[
			level
		] ?? 2
	);
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
	const [traces, setTraces] = useState<TraceRow[]>([]);
	const [loading, setLoading] = useState(false);
	const [expandedTrace, setExpandedTrace] = useState<string | null>(null);
	const [traceLogs, setTraceLogs] = useState<LogRecord[]>([]);
	const [traceSpans, setTraceSpans] = useState<SpanBar[]>([]);

	useEffect(() => {
		if (!enabled) return;
		setLoading(true);

		let where = "WHERE trace_id IS NOT NULL AND trace_id != ''";
		if (filters.trace_id) where += ` AND trace_id = '${filters.trace_id}'`;
		if (filters.service) where += ` AND service = '${filters.service}'`;
		if (filters.project) where += ` AND project = '${filters.project}'`;
		if (filters.branch) where += ` AND branch = '${filters.branch}'`;
		if (filters.version) where += ` AND version = '${filters.version}'`;
		if (filters.deployment_id) where += ` AND deployment_id = '${filters.deployment_id}'`;
		if (filters.level) where += ` AND level = '${filters.level}'`;
		if (filters.grep) where += ` AND message LIKE '%${filters.grep.replace(/'/g, "''")}%'`;
		if (filters.from) {
			const match = filters.from.match(/^(\d+)([smhd])$/);
			if (match) {
				const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000 };
				where += ` AND created_at > ${Date.now() - parseInt(match[1]) * (ms[match[2]] ?? 3600_000)}`;
			}
		}

		const sql = `
      SELECT
        trace_id,
        MIN(timestamp) as first_ts,
        COUNT(DISTINCT COALESCE(span_id, CAST(id AS VARCHAR))) as span_count,
        MAX(CASE WHEN meta IS NOT NULL AND meta LIKE '%duration_ms%' THEN CAST(json_extract(meta, '$.duration_ms') AS DOUBLE) ELSE 0 END) as duration_ms,
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
			.catch((err) => console.error("Traces query failed:", err))
			.finally(() => setLoading(false));
	}, [enabled, filters]);

	const expandTrace = useCallback(
		async (traceId: string) => {
			if (expandedTrace === traceId) {
				setExpandedTrace(null);
				return;
			}
			setExpandedTrace(traceId);

			const sql = `SELECT * FROM logs WHERE trace_id = '${traceId}' ORDER BY created_at ASC LIMIT 200`;
			try {
				const res = await apiPost<QueryResult>("/query", { sql });
				const logs = res.rows as unknown as LogRecord[];
				setTraceLogs(logs);

				// Build spans from wide events (meta.event = true or meta.duration_ms exists)
				const spans: SpanBar[] = [];
				const baseTime = logs.length > 0 ? new Date(logs[0].timestamp).getTime() : 0;

				const wideEvents = logs.filter((l) => {
					try {
						const meta = typeof l.meta === "string" ? JSON.parse(l.meta || "{}") : l.meta || {};
						return meta.event === true || meta.duration_ms != null;
					} catch {
						return false;
					}
				});

				if (wideEvents.length > 0) {
					for (const ev of wideEvents) {
						const meta = typeof ev.meta === "string" ? JSON.parse(ev.meta || "{}") : ev.meta || {};
						const durationMs = Number(meta.duration_ms) || 1;
						spans.push({
							name: ev.message,
							service: ev.service || "unknown",
							start: Math.max(0, new Date(ev.timestamp).getTime() - baseTime - durationMs),
							duration: durationMs,
							level: ev.level,
						});
					}
				} else {
					// Group by span_id or service
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
						spans.push({
							name: key,
							service: group[0].service || "unknown",
							start,
							duration: Math.max(end - start, 1),
							level: maxLevel,
						});
					}
				}

				setTraceSpans(spans);
			} catch {
				setTraceLogs([]);
				setTraceSpans([]);
			}
		},
		[expandedTrace],
	);

	const statusDot = (level: string) => {
		const colors: Record<string, string> = {
			fatal: "bg-fuchsia-400",
			error: "bg-red-400",
			warn: "bg-amber-400",
			info: "bg-emerald-400",
		};
		return colors[level] || colors.info;
	};

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TimelineStrip
				from={filters.from || "1h"}
				to={filters.to}
				filters={filters as Record<string, string | undefined>}
				onTimeRangeSelect={(from, to) => onUpdateFilters({ from, to })}
			/>
			<div className="flex-1 overflow-y-auto">
				{loading && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						Loading traces...
					</div>
				)}
				{!loading && traces.length === 0 && (
					<div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
						No traces found. Logs need a trace_id to appear here.
					</div>
				)}
				<div className="divide-y divide-border/50">
					{traces.map((t) => (
						<div key={t.trace_id}>
							<button
								type="button"
								onClick={() => expandTrace(t.trace_id)}
								className="flex w-full items-center gap-3 px-4 py-2 text-left font-mono text-xs transition-colors hover:bg-muted/50"
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
								<span className="min-w-0 flex-1 truncate text-muted-foreground">{t.services}</span>
							</button>

							{expandedTrace === t.trace_id && (
								<div className="border-t border-border/50 bg-muted/20 px-4 py-4 space-y-4">
									{/* Waterfall */}
									{traceSpans.length > 0 && (
										<div>
											<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
												Waterfall
											</div>
											<div className="space-y-1">
												{traceSpans.map((span, i) => {
													const maxEnd = Math.max(
														...traceSpans.map((s) => s.start + s.duration),
														1,
													);
													const leftPct = (span.start / maxEnd) * 100;
													const widthPct = Math.max((span.duration / maxEnd) * 100, 0.5);
													const isError = levelPriority(span.level) >= 4;
													return (
														<div key={i} className="flex items-center gap-2">
															<span className="w-24 shrink-0 truncate text-[10px] text-muted-foreground">
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
									)}

									{/* Trace logs */}
									<div>
										<div className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
											Logs ({traceLogs.length})
										</div>
										<div className="rounded-md border border-border overflow-hidden divide-y divide-border/50">
											{traceLogs.map((l) => (
												<div
													key={l.id}
													className="flex items-center gap-3 px-3 py-1 font-mono text-xs"
												>
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
