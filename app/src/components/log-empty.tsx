import { Loader2, Radio, SearchX } from "lucide-react";
import {
	activeFilterCount,
	describeRange,
	FACET_KEYS,
	isRelativeTime,
	splitValues,
	TIME_PRESETS,
} from "@/lib/log-filters";
import type { Filters } from "@/types";

const FILTER_LABELS: Record<string, string> = {
	level: "level",
	service: "service",
	project: "project",
	branch: "branch",
	version: "version",
	deployment_id: "deployment",
};

/** The next preset up from the current one, for the "widen" shortcut. */
function nextWiderPreset(from?: string): { value: string; label: string } | null {
	if (!isRelativeTime(from)) return null;
	const index = TIME_PRESETS.findIndex((p) => p.value === from);
	const wider = index >= 0 ? TIME_PRESETS[index + 1] : undefined;
	return wider ? { value: wider.value, label: wider.label } : null;
}

function Action({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="h-7 rounded-md border border-border px-2.5 text-xs text-foreground hover:border-border-strong hover:bg-accent"
		>
			{children}
		</button>
	);
}

/**
 * The empty state is where a log viewer most often loses people: the reason
 * there's nothing on screen is almost always a filter they can't see from
 * here. So name the range, name the filters, and offer the two ways out.
 */
export function LogEmptyState({
	filters,
	loading,
	live,
	streamConnected,
	onUpdateFilters,
	onClearFilters,
}: {
	filters: Filters;
	loading?: boolean;
	live?: boolean;
	streamConnected?: boolean;
	onUpdateFilters: (updates: Partial<Filters>) => void;
	onClearFilters: () => void;
}) {
	if (loading) {
		return (
			<div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
				<Loader2 className="size-3.5 animate-spin" />
				Loading logs…
			</div>
		);
	}

	if (live) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
				<Radio
					className={
						streamConnected
							? "size-5 animate-pulse text-status-good"
							: "size-5 text-muted-foreground"
					}
				/>
				<p className="text-xs font-medium">
					{streamConnected ? "Waiting for logs…" : "Not connected"}
				</p>
				<p className="max-w-xs text-2xs text-muted-foreground">
					{streamConnected
						? "New records appear here as they arrive."
						: "The live stream dropped. Toggle Live off and on to reconnect."}
				</p>
			</div>
		);
	}

	const wider = nextWiderPreset(filters.from);
	const narrowing = FACET_KEYS.filter((key) => filters[key]).map(
		(key) => `${FILTER_LABELS[key]} ${splitValues(filters[key]).join(", ")}`,
	);
	if (filters.grep) narrowing.push(`matching “${filters.grep}”`);
	const hasFilters = activeFilterCount(filters) > 0;

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
			<SearchX className="size-5 text-muted-foreground" />
			<div className="space-y-1">
				<p className="text-xs font-medium">No logs found</p>
				<p className="max-w-md text-2xs leading-relaxed text-muted-foreground">
					Nothing in <span className="text-foreground">{describeRange(filters).toLowerCase()}</span>
					{narrowing.length > 0 && (
						<>
							{" with "}
							<span className="text-foreground">{narrowing.join(" and ")}</span>
						</>
					)}
					.
				</p>
			</div>
			{(wider || filters.to || hasFilters) && (
				<div className="flex flex-wrap items-center justify-center gap-1.5">
					{wider && (
						<Action onClick={() => onUpdateFilters({ from: wider.value, to: undefined })}>
							Widen to {wider.label}
						</Action>
					)}
					{!wider && (filters.from || filters.to) && (
						<Action onClick={() => onUpdateFilters({ from: undefined, to: undefined })}>
							Search all time
						</Action>
					)}
					{hasFilters && <Action onClick={onClearFilters}>Clear all filters</Action>}
				</div>
			)}
		</div>
	);
}
