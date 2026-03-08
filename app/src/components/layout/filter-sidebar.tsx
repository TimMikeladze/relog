import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/api/client";
import type { Filters, QueryResult, View } from "@/types";
import {
	ChevronDown,
	ChevronRight,
	Clock,
	Gauge,
	Server,
	FolderOpen,
	GitBranch,
	Rocket,
	Route,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

const TIME_PRESETS = [
	{ label: "5m", value: "5m" },
	{ label: "15m", value: "15m" },
	{ label: "1h", value: "1h" },
	{ label: "6h", value: "6h" },
	{ label: "24h", value: "24h" },
	{ label: "7d", value: "7d" },
];

const LEVEL_DOTS: Record<string, string> = {
	trace: "bg-zinc-400",
	debug: "bg-blue-400",
	info: "bg-emerald-400",
	warn: "bg-amber-400",
	error: "bg-red-400",
	fatal: "bg-fuchsia-400",
};

interface FacetCounts {
	level: Record<string, number>;
	service: Record<string, number>;
	project: Record<string, number>;
	branch: Record<string, number>;
	deployment_id: Record<string, number>;
}

function isRelativeTime(v?: string): boolean {
	return !!v && /^\d+[smhd]$/.test(v);
}

function toDatetimeLocal(iso?: string): string {
	if (!iso || isRelativeTime(iso)) return "";
	try {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	} catch {
		return "";
	}
}

function fromDatetimeLocal(val: string): string | undefined {
	if (!val) return undefined;
	return new Date(val).toISOString();
}

function Section({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="border-b border-border/50">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
			>
				{open ? (
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3 w-3 text-muted-foreground" />
				)}
				{title}
			</button>
			{open && <div className="px-4 pb-3">{children}</div>}
		</div>
	);
}

function FacetList({
	items,
	selected,
	onSelect,
	dotColors,
}: {
	items: Record<string, number>;
	selected?: string;
	onSelect: (value: string | undefined) => void;
	dotColors?: Record<string, string>;
}) {
	const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]);
	if (sorted.length === 0) {
		return <span className="text-[10px] text-muted-foreground italic">No data</span>;
	}
	return (
		<div className="space-y-0.5">
			{sorted.map(([value, count]) => (
				<button
					key={value}
					type="button"
					onClick={() => onSelect(selected === value ? undefined : value)}
					className={cn(
						"flex w-full items-center gap-2 rounded px-2 py-1 text-xs transition-colors",
						selected === value
							? "bg-primary/15 text-primary font-medium"
							: "text-foreground hover:bg-muted/50",
					)}
				>
					{dotColors && (
						<span
							className={cn("h-2 w-2 shrink-0 rounded-full", dotColors[value] || "bg-zinc-400")}
						/>
					)}
					<span className="flex-1 truncate text-left">{value}</span>
					<span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{count}</span>
				</button>
			))}
		</div>
	);
}

export function FilterSidebar({
	filters,
	view,
	onUpdateFilter,
	onUpdateFilters,
	onClearFilters,
}: {
	filters: Filters;
	view: View;
	onUpdateFilter: (key: keyof Filters, value: string | undefined) => void;
	onUpdateFilters: (updates: Partial<Filters>) => void;
	onClearFilters: () => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [facets, setFacets] = useState<FacetCounts>({
		level: {},
		service: {},
		project: {},
		branch: {},
		deployment_id: {},
	});

	const hasFilters = Object.values(filters).some(Boolean);
	const activePreset = isRelativeTime(filters.from) ? filters.from : null;

	// Fetch facet counts
	useEffect(() => {
		const timeConstraint = filters.from
			? filters.from.match(/^(\d+)([smhd])$/)
				? (() => {
						const match = filters.from!.match(/^(\d+)([smhd])$/)!;
						const ms: Record<string, number> = {
							s: 1000,
							m: 60_000,
							h: 3600_000,
							d: 86400_000,
						};
						return `WHERE created_at > ${Date.now() - parseInt(match[1]) * (ms[match[2]] ?? 3600_000)}`;
					})()
				: `WHERE created_at > ${new Date(filters.from).getTime()}`
			: "WHERE created_at > " + (Date.now() - 3600_000);

		const queries = [
			`SELECT level, COUNT(*) as count FROM logs ${timeConstraint} GROUP BY level`,
			`SELECT service, COUNT(*) as count FROM logs ${timeConstraint} AND service IS NOT NULL GROUP BY service ORDER BY count DESC LIMIT 20`,
			`SELECT project, COUNT(*) as count FROM logs ${timeConstraint} AND project IS NOT NULL GROUP BY project ORDER BY count DESC LIMIT 20`,
			`SELECT branch, COUNT(*) as count FROM logs ${timeConstraint} AND branch IS NOT NULL GROUP BY branch ORDER BY count DESC LIMIT 20`,
			`SELECT deployment_id, COUNT(*) as count FROM logs ${timeConstraint} AND deployment_id IS NOT NULL GROUP BY deployment_id ORDER BY count DESC LIMIT 10`,
		];

		Promise.all(queries.map((sql) => apiPost<QueryResult>("/query", { sql }).catch(() => ({ rows: [], count: 0, time_ms: 0 }))))
			.then(([levelRes, serviceRes, projectRes, branchRes, deployRes]) => {
				const toMap = (res: QueryResult, key: string) =>
					Object.fromEntries(res.rows.map((r) => [r[key] as string, Number(r.count)]));
				setFacets({
					level: toMap(levelRes, "level"),
					service: toMap(serviceRes, "service"),
					project: toMap(projectRes, "project"),
					branch: toMap(branchRes, "branch"),
					deployment_id: toMap(deployRes, "deployment_id"),
				});
			});
	}, [filters.from]);

	const miniItems = [
		{ icon: Clock, label: "Timeline", filter: "from" as const },
		{ icon: Gauge, label: "Level", filter: "level" as const },
		{ icon: Server, label: "Service", filter: "service" as const },
		{ icon: FolderOpen, label: "Project", filter: "project" as const },
		{ icon: GitBranch, label: "Branch", filter: "branch" as const },
		{ icon: Rocket, label: "Deploy", filter: "deployment_id" as const },
		...(view === "traces" ? [{ icon: Route, label: "Trace", filter: "trace_id" as const }] : []),
	];

	if (collapsed) {
		return (
			<div className="flex w-11 shrink-0 flex-col items-center border-r border-border">
				<button
					type="button"
					onClick={() => setCollapsed(false)}
					className="flex h-9 w-full items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					title="Expand filters"
				>
					<PanelLeftOpen className="h-3.5 w-3.5" />
				</button>
				<div className="w-full border-t border-border/50" />
				{miniItems.map(({ icon: Icon, label, filter }) => {
					const isActive = !!filters[filter];
					return (
						<button
							key={filter}
							type="button"
							onClick={() => setCollapsed(false)}
							title={label}
							className={cn(
								"flex h-9 w-full items-center justify-center transition-colors hover:bg-muted",
								isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
							)}
						>
							<Icon className="h-3.5 w-3.5" />
						</button>
					);
				})}
			</div>
		);
	}

	return (
		<div className="flex w-64 shrink-0 flex-col border-r border-border overflow-hidden">
			<div className="flex items-center justify-between border-b border-border px-4 py-2">
				<span className="text-xs font-medium">Filters</span>
				<div className="flex items-center gap-1">
					{hasFilters && (
						<button
							type="button"
							onClick={onClearFilters}
							className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							Reset
						</button>
					)}
					<button
						type="button"
						onClick={() => setCollapsed(true)}
						className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						title="Collapse filters"
					>
						<PanelLeftClose className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				<Section title="Timeline" defaultOpen>
					<div className="space-y-2">
						<div className="flex gap-1">
							{TIME_PRESETS.map((p) => (
								<button
									key={p.value}
									type="button"
									onClick={() => {
										if (activePreset === p.value) {
											onUpdateFilters({ from: undefined, to: undefined });
										} else {
											onUpdateFilters({ from: p.value, to: undefined });
										}
									}}
									className={cn(
										"rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
										activePreset === p.value
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:bg-muted hover:text-foreground",
									)}
								>
									{p.label}
								</button>
							))}
						</div>
						<div className="space-y-1.5">
							<div className="flex items-center gap-1.5">
								<span className="text-[10px] text-muted-foreground w-8">From</span>
								<input
									type="datetime-local"
									value={toDatetimeLocal(filters.from)}
									onChange={(e) => onUpdateFilter("from", fromDatetimeLocal(e.target.value))}
									className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] dark:[color-scheme:dark]"
								/>
							</div>
							<div className="flex items-center gap-1.5">
								<span className="text-[10px] text-muted-foreground w-8">To</span>
								<input
									type="datetime-local"
									value={toDatetimeLocal(filters.to)}
									onChange={(e) => onUpdateFilter("to", fromDatetimeLocal(e.target.value))}
									className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] dark:[color-scheme:dark]"
								/>
							</div>
						</div>
					</div>
				</Section>

				<Section title="Level" defaultOpen>
					<FacetList
						items={Object.fromEntries(
							LOG_LEVELS.map((l) => [l, facets.level[l] || 0]),
						)}
						selected={filters.level}
						onSelect={(v) => onUpdateFilter("level", v)}
						dotColors={LEVEL_DOTS}
					/>
				</Section>

				<Section title="Service" defaultOpen>
					<FacetList
						items={facets.service}
						selected={filters.service}
						onSelect={(v) => onUpdateFilter("service", v)}
					/>
				</Section>

				<Section title="Project">
					<FacetList
						items={facets.project}
						selected={filters.project}
						onSelect={(v) => onUpdateFilter("project", v)}
					/>
				</Section>

				<Section title="Branch">
					<FacetList
						items={facets.branch}
						selected={filters.branch}
						onSelect={(v) => onUpdateFilter("branch", v)}
					/>
				</Section>

				<Section title="Deployment ID">
					<FacetList
						items={facets.deployment_id}
						selected={filters.deployment_id}
						onSelect={(v) => onUpdateFilter("deployment_id", v)}
					/>
				</Section>

				{view === "traces" && (
					<Section title="Trace ID">
						<input
							type="text"
							placeholder="Filter by trace ID..."
							value={filters.trace_id || ""}
							onChange={(e) => onUpdateFilter("trace_id", e.target.value || undefined)}
							className="h-7 w-full rounded border border-border bg-background px-2 text-xs font-mono outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
						/>
					</Section>
				)}
			</div>
		</div>
	);
}
