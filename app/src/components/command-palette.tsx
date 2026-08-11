import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface Command {
	name: string;
	shortcut?: string;
	category?: string;
	action: () => void;
}

export function CommandPalette({
	commands,
	onClose,
}: {
	commands: Command[];
	onClose: () => void;
}) {
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const filtered = useMemo(() => {
		if (!query) return commands;
		const q = query.toLowerCase();
		return commands.filter(
			(c) =>
				c.name.toLowerCase().includes(q) || (c.category && c.category.toLowerCase().includes(q)),
		);
	}, [commands, query]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [filtered]);

	const execute = useCallback(
		(cmd: Command) => {
			cmd.action();
			onClose();
		},
		[onClose],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowDown":
				case "j":
					if (e.key === "j" && !e.ctrlKey) break;
					e.preventDefault();
					setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
					break;
				case "ArrowUp":
				case "k":
					if (e.key === "k" && !e.ctrlKey) break;
					e.preventDefault();
					setSelectedIndex((i) => Math.max(i - 1, 0));
					break;
				case "Enter":
					e.preventDefault();
					if (filtered[selectedIndex]) execute(filtered[selectedIndex]);
					break;
				case "Escape":
					e.preventDefault();
					onClose();
					break;
			}
		},
		[filtered, selectedIndex, execute, onClose],
	);

	// Scroll selected item into view
	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const item = list.children[selectedIndex] as HTMLElement;
		if (item) item.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	// Group by category
	const grouped = useMemo(() => {
		const groups: { category: string; commands: (Command & { globalIndex: number })[] }[] = [];
		const categoryMap = new Map<string, (Command & { globalIndex: number })[]>();

		filtered.forEach((cmd, i) => {
			const cat = cmd.category || "Actions";
			if (!categoryMap.has(cat)) {
				categoryMap.set(cat, []);
				groups.push({ category: cat, commands: categoryMap.get(cat)! });
			}
			categoryMap.get(cat)!.push({ ...cmd, globalIndex: i });
		});

		return groups;
	}, [filtered]);

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]" onClick={onClose}>
			{/* A plain black scrim is invisible over a near-black app. The blur is
			    what actually separates the palette from the log rows behind it. */}
			<div className="scrim" />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border-strong bg-popover shadow-overlay"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={handleKeyDown}
			>
				<div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Type a command…"
						aria-label="Search commands"
						// The global focus ring would trace this full-width input and
						// light up the entire header. In a modal whose only focusable
						// field is auto-focused, the caret is indication enough.
						className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
					/>
				</div>
				{/* `mask-image` fades the final row so a clipped list reads as
				    "more below" rather than as a rendering glitch. */}
				<div
					ref={listRef}
					className="max-h-80 overflow-y-auto p-1.5 [mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)]"
				>
					{grouped.length === 0 ? (
						<div className="px-4 py-6 text-center text-xs text-muted-foreground">
							No matching commands
						</div>
					) : (
						grouped.map((group) => (
							<div key={group.category}>
								<div className="px-2.5 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
									{group.category}
								</div>
								{group.commands.map((cmd) => {
									const active = cmd.globalIndex === selectedIndex;
									return (
										<button
											key={cmd.name}
											type="button"
											onClick={() => execute(cmd)}
											aria-selected={active}
											className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs ${
												active ? "bg-accent text-accent-foreground" : "text-popover-foreground"
											}`}
										>
											<span className="truncate">{cmd.name}</span>
											{cmd.shortcut && (
												<kbd className="shrink-0 rounded border border-border px-1 text-2xs text-muted-foreground">
													{cmd.shortcut}
												</kbd>
											)}
										</button>
									);
								})}
							</div>
						))
					)}
				</div>
				<div className="flex items-center gap-3 border-t border-border bg-card px-3.5 py-2 text-2xs text-muted-foreground">
					<span>
						<kbd className="rounded border border-border px-1">&uarr;&darr;</kbd> navigate
					</span>
					<span>
						<kbd className="rounded border border-border px-1">&crarr;</kbd> select
					</span>
					<span>
						<kbd className="rounded border border-border px-1">esc</kbd> close
					</span>
				</div>
			</div>
		</div>
	);
}
