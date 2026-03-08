import { useState, useCallback } from "react";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";
import { JsonViewer } from "./json-viewer";
import { LogRow } from "./log-row";
import { X, Copy, Route, Rows3, Check, Circle, Bookmark, BookmarkCheck } from "lucide-react";
import { apiGet } from "@/api/client";
import type { LogsResponse } from "@/types";
import { useBookmarks } from "@/hooks/use-bookmarks";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

function formatFullTimestamp(ts: string): string {
	try {
		const d = new Date(ts);
		const time = d.toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 2 });
		const tz = d.toLocaleTimeString("en-US", { timeZoneName: "shortOffset" }).split(" ").pop();
		return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")} ${time} ${tz}`;
	} catch {
		return ts;
	}
}

function DetailField({
	label,
	value,
	onClick,
}: {
	label: string;
	value: string | number | null | undefined;
	onClick?: () => void;
}) {
	if (value === null || value === undefined || value === "") return null;
	return (
		<div className="flex items-baseline justify-between gap-3 py-1.5">
			<span className="shrink-0 text-[11px] text-muted-foreground/80 font-medium">{label}</span>
			{onClick ? (
				<button
					type="button"
					onClick={onClick}
					className="text-right text-xs truncate max-w-[260px] text-primary hover:underline transition-colors active:text-primary/80"
				>
					{String(value)}
				</button>
			) : (
				<span
					className="text-right text-xs truncate max-w-[260px] text-foreground/70 font-mono"
					title={String(value)}
				>
					{String(value)}
				</span>
			)}
		</div>
	);
}

function SectionHeader({
	children,
	inline = false,
}: {
	children: React.ReactNode;
	inline?: boolean;
}) {
	if (inline) {
		return (
			<div className="pt-4 pb-2.5 flex items-center gap-2.5 first:pt-2">
				<div className="h-px flex-1 bg-gradient-to-r from-border/50 via-border/30 to-transparent" />
				<span className="text-[9px] font-semibold text-muted-foreground/80 uppercase tracking-widest">
					{children}
				</span>
				<div className="h-px flex-1 bg-gradient-to-l from-border/50 via-border/30 to-transparent" />
			</div>
		);
	}
	return (
		<div className="pt-4 pb-1.5">
			<span className="text-[11px] font-semibold text-foreground">{children}</span>
		</div>
	);
}

export function LogDetailPanel({
	log,
	onClose,
	onNavigateTrace,
	variant = "panel",
}: {
	log: LogRecord;
	onClose: () => void;
	onNavigateTrace?: (traceId: string) => void;
	variant?: "panel" | "inline";
}) {
	const meta = parseMeta(log.meta);
	const [copied, setCopied] = useState(false);
	const [contextLogs, setContextLogs] = useState<LogRecord[] | null>(null);
	const [loadingContext, setLoadingContext] = useState(false);
	const { toggle, isBookmarked } = useBookmarks();
	const bmId = `log:${log.id}`;

	const copyAsJson = useCallback(() => {
		navigator.clipboard.writeText(JSON.stringify(log, null, 2));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}, [log]);

	const loadContext = useCallback(async () => {
		setLoadingContext(true);
		try {
			const before = await apiGet<LogsResponse>("/logs", {
				to: log.timestamp,
				limit: "5",
				...(log.service ? { service: log.service } : {}),
			});
			const after = await apiGet<LogsResponse>("/logs", {
				from: log.timestamp,
				limit: "6",
				...(log.service ? { service: log.service } : {}),
			});
			const all = [...(before.rows || []), ...(after.rows || [])];
			const unique = Array.from(new Map(all.map((l) => [l.id, l])).values());
			unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
			setContextLogs(unique);
		} catch {
			setContextLogs([]);
		} finally {
			setLoadingContext(false);
		}
	}, [log]);

	const httpMeta = meta
		? {
				method: meta.http_method as string | undefined,
				status: meta.http_status as number | undefined,
				path: meta.http_path as string | undefined,
				duration: meta.duration_ms as number | undefined,
				userAgent: meta.user_agent as string | undefined,
			}
		: null;

	const hasHttp = httpMeta && (httpMeta.method || httpMeta.status);

	const inlineClass =
		variant === "inline"
			? "flex w-full flex-col border border-border/50 bg-gradient-to-br from-card via-card/98 to-card/95 rounded-xl shadow-md backdrop-blur-md log-detail-inline"
			: "flex h-full w-full flex-col border-l border-border bg-card";

	return (
		<div className={inlineClass}>
			{/* Header */}
			<div
				className={`flex items-center justify-between px-4 py-3.5 ${variant === "inline" ? "bg-gradient-to-r from-muted/30 via-muted/10 to-transparent border-b border-border/30" : "border-b border-border"}`}
			>
				<div className="flex items-center gap-2 min-w-0">
					{hasHttp ? (
						<span
							className={`${variant === "inline" ? "text-sm font-semibold tracking-tight text-foreground" : "text-xs font-semibold"} truncate`}
						>
							{httpMeta?.method} {httpMeta?.path || log.message}
						</span>
					) : (
						<span
							className={`${variant === "inline" ? "text-sm font-semibold tracking-tight text-foreground" : "text-xs font-semibold"} truncate`}
						>
							{log.message}
						</span>
					)}
				</div>
				{variant === "inline" && (
					<button
						type="button"
						onClick={onClose}
						className="shrink-0 rounded-md p-1 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground active:scale-95"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>

			<div
				className={`flex-1 overflow-y-auto px-4 pb-4 pt-1 ${variant === "inline" ? "scrollbar-thin scrollbar-thumb-border/40 scrollbar-track-transparent hover:scrollbar-thumb-border/60" : ""}`}
			>
				{/* Event timeline */}
				<div
					className={`py-3 space-y-2 ${variant === "inline" ? "bg-gradient-to-r from-muted/20 to-transparent rounded-lg px-3 py-3" : ""}`}
				>
					<div className="flex items-center gap-2">
						<Circle
							className={`h-2.5 w-2.5 shrink-0 ${variant === "inline" ? "fill-primary text-primary" : "text-muted-foreground"}`}
						/>
						<span
							className={`${variant === "inline" ? "text-xs font-semibold" : "text-xs font-medium"}`}
						>
							Log recorded
						</span>
						<span
							className={`ml-auto text-[10px] ${variant === "inline" ? "text-muted-foreground/80" : "text-muted-foreground"} tabular-nums font-mono`}
						>
							{formatFullTimestamp(log.timestamp)}
						</span>
					</div>

					{/* Request info if HTTP */}
					{hasHttp && (
						<div
							className={`ml-1 border-l pl-4 space-y-1 ${variant === "inline" ? "border-primary/30" : "border-border/50"}`}
						>
							<DetailField label="Method" value={httpMeta?.method} />
							<DetailField label="Status" value={httpMeta?.status} />
							<DetailField label="Path" value={httpMeta?.path} />
							{httpMeta?.userAgent && <DetailField label="User Agent" value={httpMeta.userAgent} />}
						</div>
					)}

					{httpMeta?.duration != null && (
						<div className="flex items-center gap-2">
							<Circle
								className={`h-2.5 w-2.5 shrink-0 ${variant === "inline" ? "fill-emerald-500 text-emerald-500" : "fill-emerald-400 text-emerald-400"}`}
							/>
							<span
								className={`text-xs font-medium ${variant === "inline" ? "text-emerald-600 dark:text-emerald-400" : ""}`}
							>
								Completed in {Math.round(httpMeta.duration)}ms
							</span>
						</div>
					)}
				</div>

				{/* Level + Message */}
				<div
					className={`border-t border-border/50 pt-3 space-y-2 ${variant === "inline" ? "pb-2" : ""}`}
				>
					<div className="flex items-center gap-2">
						<LevelBadge level={log.level} />
						<span className="text-[10px] text-muted-foreground">#{log.id}</span>
					</div>
					<p
						className={`rounded-lg text-xs whitespace-pre-wrap break-all leading-relaxed font-mono ${variant === "inline" ? "bg-gradient-to-b from-muted/40 to-muted/25 border border-border/25 p-3 hover:from-muted/45 hover:to-muted/30 transition-all" : "bg-muted/50 p-2.5"}`}
					>
						{log.message}
					</p>
				</div>

				{/* Identification */}
				{(log.service || log.host || log.pid) && (
					<>
						<SectionHeader inline={variant === "inline"}>Identification</SectionHeader>
						<div
							className={`rounded-lg ${variant === "inline" ? "bg-gradient-to-br from-muted/20 to-muted/10 border border-border/25 divide-y divide-border/15 px-3 py-2" : "border border-border/50 divide-y divide-border/30 px-3"}`}
						>
							<DetailField label="Service" value={log.service} />
							<DetailField label="Host" value={log.host} />
							<DetailField label="PID" value={log.pid} />
						</div>
					</>
				)}

				{/* Trace */}
				{(log.trace_id || log.span_id) && (
					<>
						<SectionHeader inline={variant === "inline"}>Trace</SectionHeader>
						<div
							className={`rounded-lg ${variant === "inline" ? "bg-gradient-to-br from-muted/20 to-muted/10 border border-border/25 px-3 py-2" : "border border-border/50 px-3"}`}
						>
							<DetailField
								label="Trace ID"
								value={log.trace_id}
								onClick={
									log.trace_id && onNavigateTrace ? () => onNavigateTrace(log.trace_id!) : undefined
								}
							/>
							<DetailField label="Span ID" value={log.span_id} />
						</div>
					</>
				)}

				{/* Deployment Information */}
				{(log.project || log.branch || log.version || log.deployment_id) && (
					<>
						<SectionHeader inline={variant === "inline"}>Deployment Information</SectionHeader>
						<div
							className={`rounded-lg ${variant === "inline" ? "bg-gradient-to-br from-muted/20 to-muted/10 border border-border/25 px-3 py-2" : "border border-border/50 px-3"}`}
						>
							<DetailField label="Project" value={log.project} />
							<DetailField label="Branch" value={log.branch} />
							<DetailField label="Version" value={log.version} />
							<DetailField label="Deployment ID" value={log.deployment_id} />
						</div>
					</>
				)}

				{/* Metadata */}
				{meta && Object.keys(meta).length > 0 && (
					<>
						<SectionHeader inline={variant === "inline"}>Metadata</SectionHeader>
						<JsonViewer data={meta} />
					</>
				)}

				{/* Context logs */}
				{contextLogs && (
					<>
						<SectionHeader inline={variant === "inline"}>Context</SectionHeader>
						<div
							className={`rounded-lg border overflow-hidden divide-y ${variant === "inline" ? "border-border/25 divide-border/15 bg-muted/10" : "border-border divide-border/30"}`}
						>
							{contextLogs.map((l) => (
								<LogRow key={l.id} log={l} selected={l.id === log.id} />
							))}
						</div>
					</>
				)}
			</div>

			{/* Footer actions */}
			<div
				className={`flex items-center gap-1.5 px-3 py-3 ${variant === "inline" ? "border-t border-border/30 bg-gradient-to-t from-muted/15 via-muted/5 to-transparent" : "border-t border-border"}`}
			>
				<button
					type="button"
					onClick={loadContext}
					disabled={loadingContext}
					className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-all active:scale-95 ${variant === "inline" ? "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground disabled:opacity-30" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-40"} disabled:cursor-not-allowed`}
				>
					<Rows3 className="h-3 w-3" />
					Context
				</button>
				{log.trace_id && onNavigateTrace && (
					<button
						type="button"
						onClick={() => onNavigateTrace(log.trace_id!)}
						className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-all active:scale-95 ${variant === "inline" ? "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
					>
						<Route className="h-3 w-3" />
						Trace
					</button>
				)}
				<div className="flex-1" />
				<button
					type="button"
					onClick={() =>
						toggle({
							type: "log",
							label: log.message.slice(0, 60),
							timestamp: log.timestamp,
							level: log.level,
							service: log.service ?? undefined,
							logRecord: log,
						})
					}
					className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition-all active:scale-95 ${
						isBookmarked(bmId)
							? "bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
							: `${variant === "inline" ? "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`
					}`}
				>
					{isBookmarked(bmId) ? (
						<BookmarkCheck className="h-3 w-3" />
					) : (
						<Bookmark className="h-3 w-3" />
					)}
					{isBookmarked(bmId) ? "Bookmarked" : "Bookmark"}
				</button>
				<button
					type="button"
					onClick={copyAsJson}
					className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition-all active:scale-95 ${
						copied
							? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
							: `${variant === "inline" ? "text-muted-foreground/80 hover:bg-muted/50 hover:text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`
					}`}
				>
					{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					{copied ? "Copied" : "Copy JSON"}
				</button>
			</div>
		</div>
	);
}
