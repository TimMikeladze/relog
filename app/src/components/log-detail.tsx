import { useState, useCallback } from "react";
import type { LogRecord } from "@/types";
import { LevelBadge } from "./level-badge";
import { JsonViewer } from "./json-viewer";
import { LogRow } from "./log-row";
import { X, Copy, Route, Rows3, Check } from "lucide-react";
import { apiGet } from "@/api/client";
import type { LogsResponse } from "@/types";

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

function Field({
	label,
	value,
	onClick,
}: {
	label: string;
	value: string | number | null | undefined;
	onClick?: () => void;
}) {
	if (value === null || value === undefined) return null;
	return (
		<div className="flex items-baseline gap-2">
			<span className="shrink-0 text-muted-foreground text-xs w-24">{label}</span>
			{onClick ? (
				<button
					type="button"
					onClick={onClick}
					className="font-mono text-xs break-all text-primary hover:underline"
				>
					{String(value)}
				</button>
			) : (
				<span className="font-mono text-xs break-all">{String(value)}</span>
			)}
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

	return (
		<div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-card">
			<div className="flex items-center justify-between border-b border-border px-4 py-2">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium">Log #{log.id}</span>
					<LevelBadge level={log.level} />
				</div>
				<button
					type="button"
					onClick={onClose}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<div className="space-y-1.5">
					<Field label="timestamp" value={log.timestamp} />
					<Field label="level" value={log.level} />
					<Field label="service" value={log.service} />
					<Field label="host" value={log.host} />
					<Field label="pid" value={log.pid} />
					<Field
						label="trace_id"
						value={log.trace_id}
						onClick={
							log.trace_id && onNavigateTrace ? () => onNavigateTrace(log.trace_id!) : undefined
						}
					/>
					<Field label="span_id" value={log.span_id} />
					<Field label="project" value={log.project} />
					<Field label="branch" value={log.branch} />
					<Field label="version" value={log.version} />
					<Field label="deployment_id" value={log.deployment_id} />
				</div>

				<div>
					<span className="text-xs text-muted-foreground">message</span>
					<p className="mt-1 rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap break-all">
						{log.message}
					</p>
				</div>

				{meta && (
					<div>
						<span className="text-xs text-muted-foreground">meta</span>
						<div className="mt-1">
							<JsonViewer data={meta} />
						</div>
					</div>
				)}

				{contextLogs && (
					<div>
						<span className="text-xs text-muted-foreground">Context</span>
						<div className="mt-1 rounded-md border border-border overflow-hidden divide-y divide-border/50">
							{contextLogs.map((l) => (
								<LogRow key={l.id} log={l} selected={l.id === log.id} />
							))}
						</div>
					</div>
				)}
			</div>

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
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
		</div>
	);
}
