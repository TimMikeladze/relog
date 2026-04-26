import { useCallback, useMemo, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { BookmarksProvider } from "@/hooks/use-bookmarks";
import { useHashState } from "@/hooks/use-hash-state";
import { useKeyboard } from "@/hooks/use-keyboard";
import { Header } from "@/components/layout/header";
import { FilterSidebar } from "@/components/layout/filter-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { AuthDialog } from "@/components/auth-dialog";
import { CommandPalette } from "@/components/command-palette";
import type { Command } from "@/components/command-palette";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { SupportDialog } from "@/components/support-dialog";
import { GettingStartedDialog, useGettingStarted } from "@/components/getting-started-dialog";
import { ExploreView } from "@/views/explore";
import { TracesView } from "@/views/traces";
import { QueryView } from "@/views/query";
import { DashboardView } from "@/views/dashboard";
import { ViewErrorBoundary } from "@/components/view-error-boundary";
import { Loader2 } from "lucide-react";
import type { Bookmark, View } from "@/types";

function AppContent() {
	const auth = useAuth();
	const { view, filters, setView, setFilters, updateFilter, updateFilters } = useHashState();
	const [showSettings, setShowSettings] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [showSupport, setShowSupport] = useState(false);
	const gettingStarted = useGettingStarted();

	const navigateTrace = useCallback(
		(traceId: string) => {
			updateFilter("trace_id", traceId);
			setView("traces" as View);
		},
		[updateFilter, setView],
	);

	const handleBookmarkClick = useCallback(
		(b: Bookmark) => {
			if (b.type === "trace" && b.traceId) {
				updateFilter("trace_id", b.traceId);
				setView("traces" as View);
			} else if (b.type === "log" && b.logRecord) {
				setView("explore" as View);
				updateFilter("around_id", String(b.logRecord.id));
			}
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
				setShowSupport(false);
				gettingStarted.setOpen(false);
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
				<AuthDialog />
			</div>
		);
	}

	if (auth.status === "unreachable" || auth.status === "error") {
		const retryIn =
			auth.nextRetryAt !== undefined ? Math.max(0, Math.round((auth.nextRetryAt - Date.now()) / 1000)) : null;
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-6 text-center">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					<div className="text-sm font-medium">Server unreachable</div>
					<div className="text-xs text-muted-foreground">{auth.error ?? "No response from server"}</div>
					{retryIn !== null && retryIn > 0 && (
						<div className="text-[11px] text-muted-foreground">Retrying in {retryIn}s…</div>
					)}
					<button
						type="button"
						onClick={auth.retryNow}
						className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
					>
						Retry now
					</button>
				</div>
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
			<PanelGroup className="flex-1 overflow-hidden" id="relog-main">
				{showSidebar && (
					<>
						<Panel
							id="sidebar"
							defaultSize="15%"
							minSize="180px"
							maxSize="30%"
							className="overflow-hidden"
						>
							<FilterSidebar
								filters={filters}
								view={view}
								onUpdateFilter={updateFilter}
								onUpdateFilters={updateFilters}
								onClearFilters={() => setFilters({})}
								onBookmarkClick={handleBookmarkClick}
							/>
						</Panel>
						<PanelResizeHandle className="resize-handle" />
					</>
				)}
				<Panel id="main" minSize="30%" className="flex overflow-hidden">
					{view === "explore" && (
						<ViewErrorBoundary key="explore" view="Explore">
							<ExploreView
								filters={filters}
								enabled={view === "explore"}
								onNavigateTrace={navigateTrace}
								onUpdateFilters={updateFilters}
							/>
						</ViewErrorBoundary>
					)}
					{view === "traces" && (
						<ViewErrorBoundary key="traces" view="Traces">
							<TracesView
								filters={filters}
								enabled={view === "traces"}
								onUpdateFilters={updateFilters}
							/>
						</ViewErrorBoundary>
					)}
					{view === "query" && (
						<ViewErrorBoundary key="query" view="Query">
							<QueryView
								enabled={view === "query"}
								onZoom={(from, to) => {
									updateFilters({ from, to });
									setView("explore" as View);
								}}
							/>
						</ViewErrorBoundary>
					)}
					{view === "dashboard" && (
						<ViewErrorBoundary key="dashboard" view="Dashboard">
							<DashboardView enabled={view === "dashboard"} />
						</ViewErrorBoundary>
					)}
				</Panel>
			</PanelGroup>
			<StatusBar
				onSettingsClick={() => setShowSettings(true)}
				onSupportClick={() => setShowSupport(true)}
				onGettingStartedClick={() => gettingStarted.setOpen(true)}
			/>
			{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
			{showCommandPalette && (
				<CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
			)}
			{showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
			{showSupport && <SupportDialog onClose={() => setShowSupport(false)} />}
			{gettingStarted.open && (
				<GettingStartedDialog onClose={() => gettingStarted.setOpen(false)} />
			)}
		</div>
	);
}

export default function App() {
	return (
		<AuthProvider>
			<BookmarksProvider>
				<AppContent />
			</BookmarksProvider>
		</AuthProvider>
	);
}
