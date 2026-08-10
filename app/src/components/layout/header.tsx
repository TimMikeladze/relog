import { cn } from "@/lib/utils";
import type { Filters, View } from "@/types";
import { Search, X } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

const VIEW_TITLES: Record<View, { title: string; hint: string }> = {
	explore: { title: "Explore", hint: "Search and inspect log records" },
	traces: { title: "Traces", hint: "Follow requests across services" },
	query: { title: "Query", hint: "Run SQL against the log store" },
	dashboard: { title: "Dashboard", hint: "Charts built from your logs" },
};

/** Filters surfaced as removable chips in the topbar. */
const CHIP_KEYS: (keyof Filters)[] = [
	"level",
	"service",
	"project",
	"branch",
	"version",
	"deployment_id",
	"trace_id",
	"from",
	"to",
	"bookmarked",
	// `around_id` pins Explore into "jump to this log" mode; without a chip
	// there is no way back out of it.
	"around_id",
];

export function Header({
	currentView,
	filters,
	onUpdateFilter,
	onClearFilters,
}: {
	currentView: View;
	filters?: Filters;
	onUpdateFilter?: (key: keyof Filters, value: string | undefined) => void;
	onClearFilters?: () => void;
}) {
	const searchRef = useRef<HTMLInputElement>(null);
	const [localGrep, setLocalGrep] = useState(filters?.grep || "");
	const grepTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	// Sync external filter changes back to local state
	useEffect(() => {
		setLocalGrep(filters?.grep || "");
	}, [filters?.grep]);

	const handleGrepChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const val = e.target.value;
			setLocalGrep(val);
			clearTimeout(grepTimerRef.current);
			grepTimerRef.current = setTimeout(() => {
				onUpdateFilter?.("grep", val || undefined);
			}, 300);
		},
		[onUpdateFilter],
	);

	useEffect(() => () => clearTimeout(grepTimerRef.current), []);

	const showSearch = currentView === "explore" || currentView === "traces";
	const view = VIEW_TITLES[currentView] ?? VIEW_TITLES.explore;
	const chips = filters
		? CHIP_KEYS.filter((k) => filters[k]).map((k) => ({ key: k, value: filters[k] as string }))
		: [];

	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
			<SidebarTrigger className="h-7 w-7 text-muted-foreground" />
			<Separator orientation="vertical" className="mr-1 h-4" />

			<div className="flex min-w-0 shrink-0 flex-col leading-tight">
				<span className="truncate text-xs font-semibold tracking-tight">{view.title}</span>
				<span className="hidden truncate text-[10px] text-muted-foreground lg:block">
					{view.hint}
				</span>
			</div>

			{showSearch && filters && onUpdateFilter ? (
				<div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
					<div className="relative w-full max-w-md">
						<Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<input
							ref={searchRef}
							type="text"
							placeholder="Search logs..."
							value={localGrep}
							onChange={handleGrepChange}
							className="h-8 w-full rounded-md border border-border bg-muted/50 pl-9 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:bg-background focus:ring-1 focus:ring-ring"
						/>
					</div>

					{chips.length > 0 && (
						<div className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto xl:flex">
							{chips.map((chip) => (
								<button
									key={chip.key}
									type="button"
									onClick={() => onUpdateFilter(chip.key, undefined)}
									title={`Remove ${chip.key} filter`}
									className={cn(
										"group flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 pl-2 pr-1.5 text-[10px] text-muted-foreground",
										"transition-colors hover:border-destructive/40 hover:text-foreground",
									)}
								>
									<span className="font-medium text-foreground/80">{chip.key}</span>
									<span className="max-w-[10rem] truncate">{chip.value}</span>
									<X className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
								</button>
							))}
							{onClearFilters && chips.length > 0 && (
								<button
									type="button"
									onClick={onClearFilters}
									className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								>
									Clear all
								</button>
							)}
						</div>
					)}
				</div>
			) : (
				<div className="flex-1" />
			)}
		</header>
	);
}
