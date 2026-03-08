import { useState, useCallback } from "react";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";
import { JsonViewer } from "./json-viewer";
import { LogRow } from "./log-row";
import { X, Copy, Route, Rows3, Check, Circle } from "lucide-react";
import { apiGet } from "@/api/client";
import type { LogsResponse } from "@/types";

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
	mono = true,
	onClick,
}: {
	label: string;
	value: string | number | null | undefined;
	mono?: boolean;
	onClick?: () => void;
}) {
	if (value === null || value === undefined || value === "") return null;
	return (
		<div className="flex items-baseline justify-between gap-3 py-1">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			{onClick ? (
				<button
					type="button"
					onClick={onClick}
					className="text-right text-xs font-mono truncate max-w-[260px] text-primary hover:underline"
				>
					{String(value)}
				</button>
			) : (
				<span
					className={`text-right text-xs truncate max-w-[260px] ${mono ? "font-mono" : ""}`}
					title={String(value)}
				>
					{String(value)}
				</span>
			)}
		</div>
	);
}

function SectionHeader({ children }: { children: React.ReactNode }) {
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
}: {
	log: LogRecord;
	onClose: () => void;
	onNavigateTrace?: (traceId: string) => void;
}) {
	const meta = parseMeta(log.meta);
	const [copied, setCopied] = useState(false);
	const [contextLogs, setContextLogs] = useState<LogRecord[] | null>(null);
	const [loadingContext, setLoadingContext] = useState(false);

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

	return (
		<div className="flex w-[440px] shrink-0 flex-col border-l border-border bg-card">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<div className="flex items-center gap-2 min-w-0">
					{hasHttp ? (
						<span className="text-xs font-semibold font-mono truncate">
							{httpMeta?.method} {httpMeta?.path || log.message}
						</span>
					) : (
						<span className="text-xs font-semibold truncate">{log.message}</span>
					)}
				</div>
				<button
					type="button"
					onClick={onClose}
					className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto px-4 pb-4">
				{/* Event timeline */}
				<div className="py-3 space-y-2">
					<div className="flex items-center gap-2">
						<Circle className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
						<span className="text-xs font-medium">Log recorded</span>
						<span className="ml-auto text-[10px] text-muted-foreground font-mono tabular-nums">
							{formatFullTimestamp(log.timestamp)}
						</span>
					</div>

					{/* Request info if HTTP */}
					{hasHttp && (
						<div className="ml-1 border-l border-border/50 pl-4 space-y-1">
							<DetailField label="Method" value={httpMeta?.method} />
							<DetailField label="Status" value={httpMeta?.status} />
							<DetailField label="Path" value={httpMeta?.path} />
							{httpMeta?.userAgent && (
								<DetailField label="User Agent" value={httpMeta.userAgent} />
							)}
						</div>
					)}

					{httpMeta?.duration != null && (
						<div className="flex items-center gap-2">
							<Circle className="h-2.5 w-2.5 shrink-0 fill-emerald-400 text-emerald-400" />
							<span className="text-xs font-medium">
								Completed in {Math.round(httpMeta.duration)}ms
							</span>
						</div>
					)}
				</div>

				{/* Level + Message */}
				<div className="border-t border-border/50 pt-3 space-y-2">
					<div className="flex items-center gap-2">
						<LevelBadge level={log.level} />
						<span className="text-[10px] text-muted-foreground">#{log.id}</span>
					</div>
					<p className="rounded bg-muted/50 p-2.5 font-mono text-xs whitespace-pre-wrap break-all leading-relaxed">
						{log.message}
					</p>
				</div>

				{/* Identification */}
				{(log.service || log.host || log.pid) && (
					<>
						<SectionHeader>Identification</SectionHeader>
						<div className="rounded border border-border/50 divide-y divide-border/30">
							<div className="px-3">
								<DetailField label="Service" value={log.service} />
								<DetailField label="Host" value={log.host} />
								<DetailField label="PID" value={log.pid} />
							</div>
						</div>
					</>
				)}

				{/* Trace */}
				{(log.trace_id || log.span_id) && (
					<>
						<SectionHeader>Trace</SectionHeader>
						<div className="rounded border border-border/50 px-3">
							<DetailField
								label="Trace ID"
								value={log.trace_id}
								onClick={
									log.trace_id && onNavigateTrace
										? () => onNavigateTrace(log.trace_id!)
										: undefined
								}
							/>
							<DetailField label="Span ID" value={log.span_id} />
						</div>
					</>
				)}

				{/* Deployment Information */}
				{(log.project || log.branch || log.version || log.deployment_id) && (
					<>
						<SectionHeader>Deployment Information</SectionHeader>
						<div className="rounded border border-border/50 px-3">
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
						<SectionHeader>Metadata</SectionHeader>
						<JsonViewer data={meta} />
					</>
				)}

				{/* Context logs */}
				{contextLogs && (
					<>
						<SectionHeader>Context</SectionHeader>
						<div className="rounded border border-border overflow-hidden divide-y divide-border/30">
							{contextLogs.map((l) => (
								<LogRow key={l.id} log={l} selected={l.id === log.id} />
							))}
						</div>
					</>
				)}
			</div>

			{/* Footer actions */}
			<div className="flex items-center gap-1 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={loadContext}
					disabled={loadingContext}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
				>
					<Rows3 className="h-3 w-3" />
					Context
				</button>
				{log.trace_id && onNavigateTrace && (
					<button
						type="button"
						onClick={() => onNavigateTrace(log.trace_id!)}
						className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<Route className="h-3 w-3" />
						Trace
					</button>
				)}
				<div className="flex-1" />
				<button
					type="button"
					onClick={copyAsJson}
					className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
					{copied ? "Copied" : "Copy JSON"}
				</button>
			</div>
		</div>
	);
}
