import { useState, useCallback } from "react";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";
import { JsonViewer } from "./json-viewer";
import { LogRow } from "./log-row";
import { X, Copy, Route, Rows3, Check, Circle, Bookmark, BookmarkCheck } from "lucide-react";
import { apiGet } from "@/api/client";
import type { LogsResponse } from "@/types";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { formatFullTimestamp } from "@/lib/format-time";
import { cn } from "@/lib/utils";

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
			<span className="shrink-0 text-2xs text-muted-foreground/80 font-medium">{label}</span>
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
				<div className="h-px flex-1 bg-border" />
				<span className="text-2xs font-semibold text-muted-foreground/80 uppercase tracking-widest">
					{children}
				</span>
				<div className="h-px flex-1 bg-border" />
			</div>
		);
	}
	return (
		<div className="pt-4 pb-1.5">
			<span className="text-2xs font-semibold text-foreground">{children}</span>
		</div>
	);
}

/**
 * One definition for the four footer actions. The class string was copy-pasted
 * per button, and none of them set `whitespace-nowrap`, so "Copy JSON" wrapped
 * onto a second line as soon as the panel got narrow.
 */
function FooterButton({
	onClick,
	icon: Icon,
	disabled,
	active,
	activeClassName = "bg-primary/20 text-primary hover:bg-primary/25",
	children,
}: {
	onClick: () => void;
	icon: React.ComponentType<{ className?: string }>;
	disabled?: boolean;
	active?: boolean;
	activeClassName?: string;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-2xs font-medium",
				"disabled:cursor-not-allowed disabled:opacity-40",
				active ? activeClassName : "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
		>
			<Icon className="size-3" />
			{children}
		</button>
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
			? "flex w-full flex-col rounded-xl border border-border bg-card shadow-overlay log-detail-inline"
			: "flex h-full w-full flex-col border-l border-border bg-card";

	return (
		<div className={inlineClass}>
			{/* Header */}
			<div className={`flex items-center justify-between px-4 py-3.5 ${"border-b border-border"}`}>
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

			{/* Scrollbars are styled globally now. The `scrollbar-*` utilities
			    that used to be here come from a Tailwind plugin this app doesn't
			    install, so they never rendered anything. */}
			<div className="flex-1 overflow-y-auto px-4 pb-4 pt-1">
				{/* Event timeline */}
				<div className={"space-y-2 py-3"}>
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
							className={`ml-auto text-2xs ${variant === "inline" ? "text-muted-foreground/80" : "text-muted-foreground"} tabular-nums font-mono`}
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
							<Circle className={`h-2.5 w-2.5 shrink-0 ${"fill-status-good text-status-good"}`} />
							<span className={"text-xs font-medium"}>
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
						<span className="text-2xs text-muted-foreground">#{log.id}</span>
					</div>
					<p
						className={`rounded-lg text-xs whitespace-pre-wrap break-all leading-relaxed font-mono ${"bg-muted p-2.5"}`}
					>
						{log.message}
					</p>
				</div>

				{/* Identification */}
				{(log.service || log.host || log.pid) && (
					<>
						<SectionHeader inline={variant === "inline"}>Identification</SectionHeader>
						<div className={`rounded-lg ${"divide-y divide-border/50 border border-border px-3"}`}>
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
						<div className={`rounded-lg ${"border border-border px-3"}`}>
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
						<div className={`rounded-lg ${"border border-border px-3"}`}>
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
			<div className="flex items-center gap-1 overflow-x-auto border-t border-border px-2 py-2.5">
				<FooterButton onClick={loadContext} disabled={loadingContext} icon={Rows3}>
					Context
				</FooterButton>
				{log.trace_id && onNavigateTrace && (
					<FooterButton onClick={() => onNavigateTrace(log.trace_id!)} icon={Route}>
						Trace
					</FooterButton>
				)}
				<div className="flex-1" />
				<FooterButton
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
					icon={isBookmarked(bmId) ? BookmarkCheck : Bookmark}
					active={isBookmarked(bmId)}
				>
					{isBookmarked(bmId) ? "Saved" : "Bookmark"}
				</FooterButton>
				<FooterButton
					onClick={copyAsJson}
					icon={copied ? Check : Copy}
					active={copied}
					activeClassName="bg-status-good/20 text-status-good"
				>
					{copied ? "Copied" : "Copy"}
				</FooterButton>
			</div>
		</div>
	);
}
