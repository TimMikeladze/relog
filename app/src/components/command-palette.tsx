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
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
			<div className="fixed inset-0 bg-black/50" />
			<div
				className="relative w-full max-w-lg rounded-lg border border-border bg-popover shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={handleKeyDown}
			>
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<Search className="h-4 w-4 text-muted-foreground" />
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Type a command..."
						className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<div ref={listRef} className="max-h-72 overflow-y-auto p-1">
					{grouped.length === 0 ? (
						<div className="px-4 py-6 text-center text-xs text-muted-foreground">
							No matching commands
						</div>
					) : (
						grouped.map((group) => (
							<div key={group.category}>
								<div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									{group.category}
								</div>
								{group.commands.map((cmd) => (
									<button
										key={cmd.name}
										type="button"
										onClick={() => execute(cmd)}
										className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition-colors ${
											cmd.globalIndex === selectedIndex
												? "bg-muted text-foreground"
												: "text-popover-foreground hover:bg-muted/50"
										}`}
									>
										<span>{cmd.name}</span>
										{cmd.shortcut && (
											<span className="text-[10px] text-muted-foreground font-mono">
												{cmd.shortcut}
											</span>
										)}
									</button>
								))}
							</div>
						))
					)}
				</div>
				<div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
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
