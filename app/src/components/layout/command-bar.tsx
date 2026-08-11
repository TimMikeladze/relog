import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListFilter, Plus, Search, X } from "lucide-react";
import { FacetMenu } from "@/components/layout/facet-menu";
import { TimeRangeMenu } from "@/components/layout/time-range-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useFacets } from "@/hooks/use-facets";
import { activeFilterCount, levelColor, type FacetKey } from "@/lib/log-filters";
import { cn } from "@/lib/utils";
import type { Filters, View } from "@/types";

/**
 * Dimensions offered in the bar. `level` and `service` are always shown
 * because every log has them; the rest are promoted on demand so a project
 * with one branch doesn't pay for a Branch menu it will never open.
 */
const VIEW_TITLES: Record<View, string> = {
	explore: "Explore",
	traces: "Traces",
	query: "Query",
	dashboard: "Dashboard",
};

const DIMENSIONS: { key: FacetKey; label: string; alwaysShown?: boolean }[] = [
	{ key: "level", label: "Level", alwaysShown: true },
	{ key: "service", label: "Service", alwaysShown: true },
	{ key: "project", label: "Project" },
	{ key: "branch", label: "Branch" },
	{ key: "version", label: "Version" },
	{ key: "deployment_id", label: "Deployment" },
];

function SearchField({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string | undefined) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [local, setLocal] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => setLocal(value), [value]);
	useEffect(() => () => clearTimeout(timer.current), []);

	const push = useCallback(
		(next: string) => {
			setLocal(next);
			clearTimeout(timer.current);
			timer.current = setTimeout(() => onChange(next || undefined), 300);
		},
		[onChange],
	);

	const clear = useCallback(() => {
		clearTimeout(timer.current);
		setLocal("");
		onChange(undefined);
		inputRef.current?.focus();
	}, [onChange]);

	// `/` focuses search, the same convention as every other log tool. Ignored
	// while typing so it stays usable as a literal slash in a query.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
			const el = e.target as HTMLElement | null;
			if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
			e.preventDefault();
			inputRef.current?.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<div className="relative flex h-7 min-w-0 max-w-xl flex-1 items-center">
			<Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
			<input
				ref={inputRef}
				type="text"
				value={local}
				onChange={(e) => push(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape" && local) {
						e.stopPropagation();
						clear();
					}
				}}
				placeholder="Search messages and metadata…"
				aria-label="Search logs"
				className={cn(
					"h-7 w-full rounded-md border border-border bg-transparent pl-8 pr-14 text-xs outline-none",
					"placeholder:text-muted-foreground hover:border-border-strong",
					"focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
				)}
			/>
			{local ? (
				<button
					type="button"
					onClick={clear}
					aria-label="Clear search"
					className="absolute right-1.5 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					<X className="size-3" />
				</button>
			) : (
				<kbd className="pointer-events-none absolute right-2 hidden select-none rounded border border-border px-1 text-2xs leading-4 text-muted-foreground sm:block">
					/
				</kbd>
			)}
		</div>
	);
}

export function CommandBar({
	view,
	filters,
	enabled,
	onUpdateFilter,
	onUpdateFilters,
	onClearFilters,
}: {
	view: View;
	filters: Filters;
	/** False on views that don't read log filters, so facets aren't counted. */
	enabled: boolean;
	onUpdateFilter: (key: keyof Filters, value: string | undefined) => void;
	onUpdateFilters: (updates: Partial<Filters>) => void;
	onClearFilters: () => void;
}) {
	const { facets } = useFacets(filters, enabled);
	const [promoted, setPromoted] = useState<FacetKey[]>([]);

	const shown = useMemo(
		() => DIMENSIONS.filter((d) => d.alwaysShown || promoted.includes(d.key) || filters[d.key]),
		[promoted, filters],
	);
	const available = DIMENSIONS.filter((d) => !shown.includes(d));
	const activeCount = activeFilterCount(filters);

	// Query and Dashboard bring their own toolbars and don't read log filters,
	// but the bar still has to exist there — it holds the only always-visible
	// control for re-opening a collapsed nav.
	if (!enabled) {
		return (
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2.5">
				<SidebarTrigger className="size-7 shrink-0 text-muted-foreground hover:text-foreground" />
				<div className="h-4 w-px shrink-0 bg-border" />
				<span className="text-xs font-medium">{VIEW_TITLES[view]}</span>
			</div>
		);
	}

	return (
		<div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2.5">
			<SidebarTrigger className="size-7 shrink-0 text-muted-foreground hover:text-foreground" />
			<div className="h-4 w-px shrink-0 bg-border" />

			<SearchField value={filters.grep ?? ""} onChange={(v) => onUpdateFilter("grep", v)} />

			<TimeRangeMenu filters={filters} onUpdateFilters={onUpdateFilters} />

			{shown.map((dimension) => (
				<FacetMenu
					key={dimension.key}
					label={dimension.label}
					entries={facets[dimension.key]}
					selected={filters[dimension.key]}
					onChange={(v) => onUpdateFilter(dimension.key, v)}
					dotColor={dimension.key === "level" ? levelColor : undefined}
				/>
			))}

			{available.length > 0 && (
				<Popover>
					<PopoverTrigger
						aria-label="Add filter"
						className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground outline-none hover:border-border-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
					>
						<Plus className="size-3.5" />
					</PopoverTrigger>
					<PopoverContent align="start" sideOffset={6} className="w-44 gap-0 p-1">
						{available.map((dimension) => (
							<button
								key={dimension.key}
								type="button"
								onClick={() => setPromoted((prev) => [...prev, dimension.key])}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
							>
								<ListFilter className="size-3 text-muted-foreground" />
								{dimension.label}
							</button>
						))}
					</PopoverContent>
				</Popover>
			)}

			{activeCount > 0 && (
				<button
					type="button"
					onClick={() => {
						setPromoted([]);
						onClearFilters();
					}}
					className="h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					Reset
				</button>
			)}

			<div className="min-w-0 flex-1" />

			{/* `around_id` pins Explore into "jump to this log" mode. It has no
			    facet menu, so without this chip there is no way back out. */}
			{filters.around_id && (
				<button
					type="button"
					onClick={() => onUpdateFilter("around_id", undefined)}
					className="group flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs"
				>
					<span className="text-muted-foreground">Around</span>
					<span className="tabular-nums">#{filters.around_id}</span>
					<X className="size-3 opacity-50 group-hover:opacity-100" />
				</button>
			)}

			{view === "traces" && filters.trace_id && (
				<button
					type="button"
					onClick={() => onUpdateFilter("trace_id", undefined)}
					className="group flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs"
				>
					<span className="shrink-0 text-muted-foreground">Trace</span>
					<span className="truncate font-mono text-2xs">{filters.trace_id}</span>
					<X className="size-3 shrink-0 opacity-50 group-hover:opacity-100" />
				</button>
			)}
		</div>
	);
}
