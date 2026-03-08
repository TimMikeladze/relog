import { X } from "lucide-react";

const SHORTCUTS = [
	{
		category: "Navigation",
		items: [
			{ keys: "g e", desc: "Go to Explore" },
			{ keys: "g t", desc: "Go to Traces" },
			{ keys: "g q", desc: "Go to Query" },
			{ keys: "g d", desc: "Go to Dashboard" },
		],
	},
	{
		category: "Global",
		items: [
			{ keys: "\u2318K", desc: "Command palette" },
			{ keys: "?", desc: "Keyboard shortcuts" },
			{ keys: "Esc", desc: "Close panel / palette" },
		],
	},
	{
		category: "Log Table",
		items: [
			{ keys: "/", desc: "Focus search" },
			{ keys: "Enter", desc: "Expand log detail" },
		],
	},
	{ category: "Query", items: [{ keys: "\u2318\u21B5", desc: "Run query" }] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
			<div className="fixed inset-0 bg-black/50" />
			<div
				className="relative w-full max-w-md rounded-lg border border-border bg-popover p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="space-y-4">
					{SHORTCUTS.map((group) => (
						<div key={group.category}>
							<div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
								{group.category}
							</div>
							<div className="space-y-1">
								{group.items.map((item) => (
									<div key={item.keys} className="flex items-center justify-between py-0.5">
										<span className="text-xs text-popover-foreground">{item.desc}</span>
										<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
											{item.keys}
										</kbd>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
