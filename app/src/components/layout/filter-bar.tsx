import { useCallback } from "react";
import type { Filters, View } from "@/types";
import { Search, X } from "lucide-react";

const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

const TIME_PRESETS = [
	{ label: "5m", value: "5m" },
	{ label: "15m", value: "15m" },
	{ label: "1h", value: "1h" },
	{ label: "6h", value: "6h" },
	{ label: "24h", value: "24h" },
	{ label: "7d", value: "7d" },
];

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

export function FilterBar({
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
	const hasFilters = Object.values(filters).some(Boolean);

	const handlePresetClick = useCallback(
		(value: string) => {
			if (filters.from === value) {
				onUpdateFilters({ from: undefined, to: undefined });
			} else {
				onUpdateFilters({ from: value, to: undefined });
			}
		},
		[filters.from, onUpdateFilters],
	);

	const handleFromDateChange = useCallback(
		(val: string) => {
			onUpdateFilter("from", fromDatetimeLocal(val));
		},
		[onUpdateFilter],
	);

	const handleToDateChange = useCallback(
		(val: string) => {
			onUpdateFilter("to", fromDatetimeLocal(val));
		},
		[onUpdateFilter],
	);

	const activePreset = isRelativeTime(filters.from) ? filters.from : null;

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 overflow-x-auto">
			<select
				value={filters.level || ""}
				onChange={(e) => onUpdateFilter("level", e.target.value || undefined)}
				className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
			>
				<option value="">All levels</option>
				{LOG_LEVELS.map((l) => (
					<option key={l} value={l}>
						{l.toUpperCase()}
					</option>
				))}
			</select>

			<input
				type="text"
				placeholder="Service"
				value={filters.service || ""}
				onChange={(e) => onUpdateFilter("service", e.target.value || undefined)}
				className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
			/>

			<input
				type="text"
				placeholder="Project"
				value={filters.project || ""}
				onChange={(e) => onUpdateFilter("project", e.target.value || undefined)}
				className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
			/>

			<input
				type="text"
				placeholder="Branch"
				value={filters.branch || ""}
				onChange={(e) => onUpdateFilter("branch", e.target.value || undefined)}
				className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
			/>

			{(view === "explore" || view === "traces") && (
				<>
					<input
						type="text"
						placeholder="Version"
						value={filters.version || ""}
						onChange={(e) => onUpdateFilter("version", e.target.value || undefined)}
						className="h-7 w-20 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					/>
					<input
						type="text"
						placeholder="Deploy ID"
						value={filters.deployment_id || ""}
						onChange={(e) => onUpdateFilter("deployment_id", e.target.value || undefined)}
						className="h-7 w-24 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					/>
				</>
			)}

			{view === "traces" && (
				<input
					type="text"
					placeholder="Trace ID"
					value={filters.trace_id || ""}
					onChange={(e) => onUpdateFilter("trace_id", e.target.value || undefined)}
					className="h-7 w-36 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring font-mono"
				/>
			)}

			{(view === "explore" || view === "traces") && (
				<>
					<div className="h-4 w-px bg-border" />
					<div className="relative">
						<Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							placeholder="Search messages..."
							value={filters.grep || ""}
							onChange={(e) => onUpdateFilter("grep", e.target.value || undefined)}
							className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
						/>
					</div>
					<div className="h-4 w-px bg-border" />
					<div className="flex items-center gap-1">
						{TIME_PRESETS.map((p) => (
							<button
								key={p.value}
								type="button"
								onClick={() => handlePresetClick(p.value)}
								className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
									activePreset === p.value
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-muted hover:text-foreground"
								}`}
							>
								{p.label}
							</button>
						))}
					</div>
					<div className="h-4 w-px bg-border" />
					<div className="flex items-center gap-1.5">
						<input
							type="datetime-local"
							value={toDatetimeLocal(filters.from)}
							onChange={(e) => handleFromDateChange(e.target.value)}
							className="h-7 rounded-md border border-border bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] dark:[color-scheme:dark] [color-scheme:light]:not(.dark *)"
							title="Start time"
						/>
						<span className="text-[10px] text-muted-foreground">–</span>
						<input
							type="datetime-local"
							value={toDatetimeLocal(filters.to)}
							onChange={(e) => handleToDateChange(e.target.value)}
							className="h-7 rounded-md border border-border bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] dark:[color-scheme:dark] [color-scheme:light]:not(.dark *)"
							title="End time"
						/>
					</div>
				</>
			)}

			{hasFilters && (
				<>
					<div className="h-4 w-px bg-border" />
					<button
						type="button"
						onClick={onClearFilters}
						className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-3 w-3" />
						Clear
					</button>
				</>
			)}
		</div>
	);
}
