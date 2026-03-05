import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { Settings, Moon, Sun, Command } from "lucide-react";
import { useEffect, useState } from "react";

const views: { id: View; label: string }[] = [
	{ id: "explore", label: "Explore" },
	{ id: "traces", label: "Traces" },
	{ id: "query", label: "Query" },
	{ id: "dashboard", label: "Dashboard" },
];

export function Header({
	currentView,
	onViewChange,
	onSettingsClick,
	onCommandPalette,
}: {
	currentView: View;
	onViewChange: (view: View) => void;
	onSettingsClick: () => void;
	onCommandPalette: () => void;
}) {
	const [dark, setDark] = useState(() => {
		if (typeof window === "undefined") return true;
		const stored = localStorage.getItem("relog:theme");
		if (stored) return stored === "dark";
		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	});

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
		localStorage.setItem("relog:theme", dark ? "dark" : "light");
	}, [dark]);

	return (
		<header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
			<div className="flex items-center gap-4">
				<span className="text-sm font-semibold tracking-tight">relog.dev</span>
				<nav className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
					{views.map((v) => (
						<button
							key={v.id}
							type="button"
							onClick={() => onViewChange(v.id)}
							className={cn(
								"rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
								currentView === v.id
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{v.label}
						</button>
					))}
				</nav>
			</div>
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => setDark(!dark)}
					className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
				</button>
				<button
					type="button"
					onClick={onCommandPalette}
					className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Command className="h-3 w-3" />
					<span>K</span>
				</button>
				<button
					type="button"
					onClick={onSettingsClick}
					className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<Settings className="h-3.5 w-3.5" />
				</button>
			</div>
		</header>
	);
}
