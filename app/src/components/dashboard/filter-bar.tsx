import { useEffect, useState } from "react";
import { Loader2, Lock, Pencil, Plus, RefreshCw } from "lucide-react";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

export const TIME_RANGES = [
	{ label: "1h", ms: 3_600_000 },
	{ label: "6h", ms: 21_600_000 },
	{ label: "24h", ms: 86_400_000 },
	{ label: "7d", ms: 7 * 86_400_000 },
	{ label: "30d", ms: 30 * 86_400_000 },
];

export const REFRESH_OPTIONS = [
	{ label: "Off", ms: 0 },
	{ label: "10s", ms: 10_000 },
	{ label: "30s", ms: 30_000 },
	{ label: "60s", ms: 60_000 },
];

export interface FilterBarProps {
	timeRange: string;
	onTimeRange: (label: string) => void;
	service: string | null;
	onService: (s: string | null) => void;
	project: string | null;
	onProject: (p: string | null) => void;
	refreshMs: number;
	onRefreshMs: (ms: number) => void;
	loading: boolean;
	onManualRefresh: () => void;
	editMode: boolean;
	onEditMode: (v: boolean) => void;
	onAddWidget: () => void;
	canEdit: boolean;
	status: { ok: boolean; uptime: number } | null;
}

function formatUptime(ms: number): string {
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

export function FilterBar(props: FilterBarProps) {
	const [services, setServices] = useState<string[]>([]);
	const [projects, setProjects] = useState<string[]>([]);

	useEffect(() => {
		let cancelled = false;
		Promise.all([
			apiPost<QueryResult>("/query", {
				sql: "SELECT DISTINCT service FROM logs WHERE service IS NOT NULL ORDER BY service LIMIT 500",
			}),
			apiPost<QueryResult>("/query", {
				sql: "SELECT DISTINCT project FROM logs WHERE project IS NOT NULL ORDER BY project LIMIT 500",
			}),
		])
			.then(([s, p]) => {
				if (cancelled) return;
				setServices(s.rows.map((r) => String(r.service)));
				setProjects(p.rows.map((r) => String(r.project)));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
				{TIME_RANGES.map((tr) => (
					<button
						key={tr.label}
						type="button"
						onClick={() => props.onTimeRange(tr.label)}
						className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
							props.timeRange === tr.label
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{tr.label}
					</button>
				))}
			</div>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.service ?? ""}
				onChange={(e) => props.onService(e.target.value || null)}
			>
				<option value="">All services</option>
				{services.map((s) => (
					<option key={s} value={s}>
						{s}
					</option>
				))}
			</select>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.project ?? ""}
				onChange={(e) => props.onProject(e.target.value || null)}
			>
				<option value="">All projects</option>
				{projects.map((p) => (
					<option key={p} value={p}>
						{p}
					</option>
				))}
			</select>

			<div className="flex-1" />

			{props.status && (
				<span className="text-xs text-muted-foreground">
					{props.status.ok ? "online" : "degraded"} · {formatUptime(props.status.uptime)}
				</span>
			)}

			{props.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}

			<button
				type="button"
				onClick={props.onManualRefresh}
				className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label="Refresh"
			>
				<RefreshCw className="h-3.5 w-3.5" />
			</button>

			<select
				className="rounded-md border border-border bg-background px-2 py-1 text-xs"
				value={props.refreshMs}
				onChange={(e) => props.onRefreshMs(Number(e.target.value))}
			>
				{REFRESH_OPTIONS.map((o) => (
					<option key={o.label} value={o.ms}>
						Auto: {o.label}
					</option>
				))}
			</select>

			{props.canEdit && (
				<>
					<button
						type="button"
						onClick={() => props.onEditMode(!props.editMode)}
						className={`flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs ${
							props.editMode ? "bg-primary/10 text-primary" : "text-muted-foreground"
						}`}
					>
						{props.editMode ? <Pencil className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
						{props.editMode ? "Editing" : "Locked"}
					</button>
					{props.editMode && (
						<button
							type="button"
							onClick={props.onAddWidget}
							className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
						>
							<Plus className="h-3 w-3" /> Add widget
						</button>
					)}
				</>
			)}
		</div>
	);
}
