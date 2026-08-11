import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { splitValues, toggleValue } from "@/lib/log-filters";
import { cn } from "@/lib/utils";
import type { FacetEntry } from "@/hooks/use-facets";

/** Above this many options the list gets a filter box of its own. */
const SEARCHABLE_AT = 8;

function CheckBox({ checked }: { checked: boolean }) {
	return (
		<span
			className={cn(
				"flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
				checked
					? "border-primary bg-primary text-primary-foreground"
					: "border-border-strong bg-transparent",
			)}
		>
			{checked && <Check className="size-2.5" strokeWidth={3} />}
		</span>
	);
}

export function FacetMenu({
	label,
	entries,
	selected,
	onChange,
	dotColor,
	align = "start",
	className,
}: {
	label: string;
	entries: FacetEntry[];
	selected?: string;
	onChange: (value: string | undefined) => void;
	/** Swatch shown next to each option, e.g. the log-level colour. */
	dotColor?: (value: string) => string;
	align?: "start" | "center" | "end";
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const selectedValues = useMemo(() => splitValues(selected), [selected]);

	/**
	 * Selected options stay in the list even when they fall outside the
	 * current counts — otherwise a filter that now matches nothing vanishes
	 * from the menu and can't be switched off from here.
	 */
	const options = useMemo(() => {
		const seen = new Set(entries.map((e) => e.value));
		const orphans = selectedValues
			.filter((v) => !seen.has(v))
			.map((value) => ({ value, count: 0 }));
		return [...entries, ...orphans];
	}, [entries, selectedValues]);

	const visible = useMemo(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return options;
		return options.filter((o) => o.value.toLowerCase().includes(needle));
	}, [options, search]);

	const active = selectedValues.length > 0;
	const summary =
		selectedValues.length === 0
			? null
			: selectedValues.length === 1
				? selectedValues[0]
				: `${selectedValues.length} selected`;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setSearch("");
			}}
		>
			<PopoverTrigger
				className={cn(
					"flex h-7 max-w-[15rem] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs outline-none",
					"focus-visible:ring-2 focus-visible:ring-ring/60",
					active
						? "border-primary/40 bg-primary/10 text-foreground"
						: "border-border text-muted-foreground hover:border-border-strong hover:text-foreground data-[state=open]:text-foreground",
					className,
				)}
			>
				<span className={cn("shrink-0", active && "font-medium")}>{label}</span>
				{summary && (
					<>
						<span className="text-border-strong">·</span>
						<span className="truncate text-foreground">{summary}</span>
					</>
				)}
				<ChevronDown className="size-3 shrink-0 opacity-50" />
			</PopoverTrigger>

			<PopoverContent align={align} className="w-60 gap-0 p-0" sideOffset={6}>
				{options.length > SEARCHABLE_AT && (
					<div className="relative border-b border-border">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
						{/* biome-ignore lint/a11y/noAutofocus: the popover exists to be typed into */}
						<input
							autoFocus
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={`Filter ${label.toLowerCase()}…`}
							className="h-8 w-full bg-transparent pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground"
						/>
					</div>
				)}

				<div className="max-h-72 overflow-y-auto p-1">
					{visible.length === 0 ? (
						<p className="px-2 py-3 text-center text-2xs text-muted-foreground">
							{options.length === 0 ? "Nothing in this range" : "No matches"}
						</p>
					) : (
						visible.map((option) => {
							const checked = selectedValues.includes(option.value);
							return (
								<button
									key={option.value}
									type="button"
									onClick={() => onChange(toggleValue(selected, option.value))}
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
								>
									<CheckBox checked={checked} />
									{dotColor && (
										<span
											className="size-1.5 shrink-0 rounded-full"
											style={{ background: dotColor(option.value) }}
										/>
									)}
									<span className={cn("flex-1 truncate", checked && "font-medium")}>
										{option.value}
									</span>
									<span className="shrink-0 tabular-nums text-2xs text-muted-foreground">
										{option.count.toLocaleString()}
									</span>
								</button>
							);
						})
					)}
				</div>

				{active && (
					<div className="border-t border-border p-1">
						<button
							type="button"
							onClick={() => onChange(undefined)}
							className="w-full rounded-md px-2 py-1.5 text-left text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							Clear {label.toLowerCase()}
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
