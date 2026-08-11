import { useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeRange, isRelativeTime, TIME_PRESET_GROUPS, TIME_PRESETS } from "@/lib/log-filters";
import { cn } from "@/lib/utils";
import type { Filters } from "@/types";

/** ISO string → the `YYYY-MM-DDTHH:mm` local-time format the input wants. */
function toInputValue(iso?: string): string {
	if (!iso || isRelativeTime(iso)) return "";
	const d = new Date(iso);
	if (!Number.isFinite(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputValue(value: string): string | undefined {
	if (!value) return undefined;
	const d = new Date(value);
	return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function AbsoluteField({
	label,
	value,
	onChange,
}: {
	label: string;
	value?: string;
	onChange: (v: string | undefined) => void;
}) {
	return (
		<label className="flex items-center gap-2">
			<span className="w-8 shrink-0 text-2xs text-muted-foreground">{label}</span>
			<input
				type="datetime-local"
				value={toInputValue(value)}
				onChange={(e) => onChange(fromInputValue(e.target.value))}
				className="h-7 flex-1 rounded-md border border-border bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
			/>
		</label>
	);
}

export function TimeRangeMenu({
	filters,
	onUpdateFilters,
}: {
	filters: Filters;
	onUpdateFilters: (updates: Partial<Filters>) => void;
}) {
	const [open, setOpen] = useState(false);
	const activePreset = isRelativeTime(filters.from) && !filters.to ? filters.from : null;
	const active = !!filters.from || !!filters.to;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				className={cn(
					"flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs outline-none",
					"focus-visible:ring-2 focus-visible:ring-ring/60",
					active
						? "border-primary/40 bg-primary/10 text-foreground"
						: "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
				)}
			>
				<Clock className="size-3 shrink-0 opacity-70" />
				<span className="max-w-[14rem] truncate">{describeRange(filters)}</span>
				<ChevronDown className="size-3 shrink-0 opacity-50" />
			</PopoverTrigger>

			<PopoverContent align="start" sideOffset={6} className="w-72 gap-0 p-0">
				<div className="space-y-2 p-2">
					{TIME_PRESET_GROUPS.map((group) => (
						<div key={group}>
							<div className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
								{group}
							</div>
							<div className="flex flex-wrap gap-1">
								{TIME_PRESETS.filter((p) => p.group === group).map((preset) => (
									<button
										key={preset.value}
										type="button"
										onClick={() => {
											onUpdateFilters({ from: preset.value, to: undefined });
											setOpen(false);
										}}
										className={cn(
											"h-6 rounded-md px-2 text-2xs font-medium tabular-nums",
											activePreset === preset.value
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:bg-accent hover:text-foreground",
										)}
									>
										{preset.value}
									</button>
								))}
							</div>
						</div>
					))}
				</div>

				<div className="space-y-1.5 border-t border-border p-2">
					<div className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
						Absolute
					</div>
					<AbsoluteField
						label="From"
						value={filters.from}
						onChange={(v) => onUpdateFilters({ from: v })}
					/>
					<AbsoluteField
						label="To"
						value={filters.to}
						onChange={(v) => onUpdateFilters({ to: v })}
					/>
				</div>

				{active && (
					<div className="border-t border-border p-1">
						<button
							type="button"
							onClick={() => {
								onUpdateFilters({ from: undefined, to: undefined });
								setOpen(false);
							}}
							className="w-full rounded-md px-2 py-1.5 text-left text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							Clear time range
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
