import { useCallback, useMemo, useState } from "react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useHashState } from "@/hooks/use-hash-state";
import { useKeyboard } from "@/hooks/use-keyboard";
import { Header } from "@/components/layout/header";
import { FilterSidebar } from "@/components/layout/filter-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { AuthDialog } from "@/components/auth-dialog";
import { CommandPalette } from "@/components/command-palette";
import type { Command } from "@/components/command-palette";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ExploreView } from "@/views/explore";
import { TracesView } from "@/views/traces";
import { QueryView } from "@/views/query";
import { DashboardView } from "@/views/dashboard";
import { Loader2 } from "lucide-react";
import type { View } from "@/types";

function AppContent() {
	const auth = useAuth();
	const { view, filters, setView, setFilters, updateFilter, updateFilters } =
		useHashState();
	const [showSettings, setShowSettings] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);

	const navigateTrace = useCallback(
		(traceId: string) => {
			updateFilter("trace_id", traceId);
			setView("traces" as View);
		},
		[updateFilter, setView],
	);

	const keyMap = useMemo(
		() => ({
			"cmd+k": () => setShowCommandPalette((v) => !v),
			"?": () => setShowShortcuts((v) => !v),
			Escape: () => {
				setShowCommandPalette(false);
				setShowSettings(false);
				setShowShortcuts(false);
			},
			"g e": () => setView("explore" as View),
			"g t": () => setView("traces" as View),
			"g q": () => setView("query" as View),
			"g d": () => setView("dashboard" as View),
		}),
		[setView],
	);

	useKeyboard(keyMap);

	const commands = useMemo<Command[]>(
		() => [
			{
				name: "Go to Explore",
				shortcut: "g e",
				category: "Navigate",
				action: () => setView("explore" as View),
			},
			{
				name: "Go to Traces",
				shortcut: "g t",
				category: "Navigate",
				action: () => setView("traces" as View),
			},
			{
				name: "Go to Query",
				shortcut: "g q",
				category: "Navigate",
				action: () => setView("query" as View),
			},
			{
				name: "Go to Dashboard",
				shortcut: "g d",
				category: "Navigate",
				action: () => setView("dashboard" as View),
			},
			{
				name: "Filter by error level",
				category: "Filter",
				action: () => {
					updateFilter("level", "error");
					setView("explore" as View);
				},
			},
			{
				name: "Filter by warn level",
				category: "Filter",
				action: () => {
					updateFilter("level", "warn");
					setView("explore" as View);
				},
			},
			{ name: "Clear all filters", category: "Filter", action: () => setFilters({}) },
			{
				name: "Toggle dark mode",
				shortcut: "\u2318\u21E7D",
				category: "Settings",
				action: () => {
					const isDark = document.documentElement.classList.contains("dark");
					document.documentElement.classList.toggle("dark", !isDark);
					localStorage.setItem("relog:theme", isDark ? "light" : "dark");
				},
			},
			{
				name: "Open settings",
				category: "Settings",
				action: () => {
					setShowSettings(true);
					setShowCommandPalette(false);
				},
			},
			{
				name: "Keyboard shortcuts",
				shortcut: "?",
				category: "Settings",
				action: () => {
					setShowShortcuts(true);
					setShowCommandPalette(false);
				},
			},
		],
		[setView, updateFilter, setFilters],
	);

	if (auth.status === "checking") {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					<span className="text-xs text-muted-foreground">Connecting to relog.dev...</span>
				</div>
			</div>
		);
	}

	if (auth.status === "needs-auth") {
		return (
			<div className="h-screen bg-background">
				<AuthDialog onClose={() => {}} />
			</div>
		);
	}

	if (auth.status === "error") {
		return (
			<div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
				<span className="text-sm text-destructive">{auth.error}</span>
				<button
					type="button"
					onClick={() => setShowSettings(true)}
					className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
				>
					Change Server URL
				</button>
				{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
			</div>
		);
	}

	const showSidebar = view === "explore" || view === "traces";

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<Header
				currentView={view}
				onViewChange={setView}
				onSettingsClick={() => setShowSettings(true)}
				onCommandPalette={() => setShowCommandPalette(true)}
				filters={filters}
				onUpdateFilter={updateFilter}
			/>
			<div className="flex flex-1 overflow-hidden">
				{showSidebar && (
					<FilterSidebar
						filters={filters}
						view={view}
						onUpdateFilter={updateFilter}
						onUpdateFilters={updateFilters}
						onClearFilters={() => setFilters({})}
					/>
				)}
				<div className="flex flex-1 overflow-hidden">
					{view === "explore" && (
						<ExploreView
							filters={filters}
							enabled={view === "explore"}
							onNavigateTrace={navigateTrace}
							onUpdateFilters={updateFilters}
						/>
					)}
					{view === "traces" && (
						<TracesView
							filters={filters}
							enabled={view === "traces"}
							onUpdateFilters={updateFilters}
						/>
					)}
					{view === "query" && (
						<QueryView
							enabled={view === "query"}
							onZoom={(from, to) => {
								updateFilters({ from, to });
								setView("explore" as View);
							}}
						/>
					)}
					{view === "dashboard" && (
						<DashboardView
							enabled={view === "dashboard"}
							onZoom={(from, to) => {
								updateFilters({ from, to });
								setView("explore" as View);
							}}
						/>
					)}
				</div>
			</div>
			<StatusBar />
			{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
			{showCommandPalette && (
				<CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
			)}
			{showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
		</div>
	);
}

export default function App() {
	return (
		<AuthProvider>
			<AppContent />
		</AuthProvider>
	);
}
