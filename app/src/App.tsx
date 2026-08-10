import { useCallback, useMemo, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { BookmarksProvider } from "@/hooks/use-bookmarks";
import { useHashState } from "@/hooks/use-hash-state";
import { useKeyboard } from "@/hooks/use-keyboard";
import { Header } from "@/components/layout/header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { FilterSidebar } from "@/components/layout/filter-sidebar";
import { StatusBar } from "@/components/layout/status-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toggleTheme } from "@/hooks/use-theme";
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
import type { Bookmark, Filters, View } from "@/types";

function AppContent() {
	const auth = useAuth();
	const { view, filters, setView, setFilters, updateFilter, updateFilters, navigate } =
		useHashState();
	const [showSettings, setShowSettings] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [showSupport, setShowSupport] = useState(false);
	const gettingStarted = useGettingStarted();

	const navigateTrace = useCallback(
		(traceId: string) => {
			navigate("traces" as View, { trace_id: traceId });
		},
		[navigate],
	);

	const handleBookmarkClick = useCallback(
		(b: Bookmark) => {
			if (b.type === "trace" && b.traceId) {
				navigate("traces" as View, { trace_id: b.traceId });
			} else if (b.type === "log" && b.logRecord) {
				navigate("explore" as View, { around_id: String(b.logRecord.id) });
			}
		},
		[navigate],
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
				action: () => navigate("explore" as View, { level: "error" }),
			},
			{
				name: "Filter by warn level",
				category: "Filter",
				action: () => navigate("explore" as View, { level: "warn" }),
			},
			{ name: "Clear all filters", category: "Filter", action: () => setFilters({}) },
			{
				name: "Toggle dark mode",
				shortcut: "\u2318\u21E7D",
				category: "Settings",
				action: toggleTheme,
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
		[setView, navigate, setFilters],
	);

	// Quick filters in the nav sidebar only mean something on the log views —
	// setting one from query/dashboard jumps to Explore with it applied.
	// Clearing one stays put: filters survive view switches, so a filter set on
	// Explore still reads as active from the dashboard, and turning it off there
	// shouldn't drag the user off the page they're on.
	const applyQuickFilter = useCallback(
		(key: keyof Filters, value: string | undefined) => {
			const onLogView = view === "explore" || view === "traces";
			if (onLogView || value === undefined) updateFilter(key, value);
			else navigate("explore" as View, { [key]: value } as Partial<Filters>);
		},
		[view, updateFilter, navigate],
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
			auth.nextRetryAt !== undefined
				? Math.max(0, Math.round((auth.nextRetryAt - Date.now()) / 1000))
				: null;
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-6 text-center">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					<div className="text-sm font-medium">Server unreachable</div>
					<div className="text-xs text-muted-foreground">
						{auth.error ?? "No response from server"}
					</div>
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

	const viewContent = (
		<>
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
						onZoom={(from, to) => navigate("explore" as View, { from, to })}
					/>
				</ViewErrorBoundary>
			)}
			{view === "dashboard" && (
				<ViewErrorBoundary key="dashboard" view="Dashboard">
					<DashboardView enabled={view === "dashboard"} />
				</ViewErrorBoundary>
			)}
		</>
	);

	return (
		<TooltipProvider delayDuration={200}>
			<SidebarProvider
				// SidebarProvider writes `sidebar_state` on every toggle but only
				// reads it server-side; this app is client-only, so restore it here
				// or a collapsed nav springs back open on reload.
				defaultOpen={!document.cookie.includes("sidebar_state=false")}
				className="h-screen min-h-0 bg-background text-foreground"
				style={
					{
						"--sidebar-width": "14.5rem",
						"--sidebar-width-icon": "3rem",
					} as React.CSSProperties
				}
			>
				<AppSidebar
					currentView={view}
					filters={filters}
					onViewChange={setView}
					onUpdateFilter={applyQuickFilter}
					onCommandPalette={() => setShowCommandPalette(true)}
					onSettingsClick={() => setShowSettings(true)}
					onSupportClick={() => setShowSupport(true)}
					onGettingStartedClick={() => gettingStarted.setOpen(true)}
					onBookmarkClick={handleBookmarkClick}
				/>
				<SidebarInset className="flex min-w-0 flex-col overflow-hidden">
					<Header
						currentView={view}
						filters={filters}
						onUpdateFilter={updateFilter}
						onClearFilters={() => setFilters({})}
					/>
					{/* Views without a filter panel render outside the panel group:
					    react-resizable-panels keeps the main panel's stale flex
					    size when the filter panel unmounts, which left dashboard
					    widgets measuring themselves against explore's width. */}
					{showSidebar ? (
						<PanelGroup className="flex-1 overflow-hidden" id="relog-main">
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
								/>
							</Panel>
							<PanelResizeHandle className="resize-handle" />
							<Panel id="main" minSize="30%" className="flex overflow-hidden">
								{viewContent}
							</Panel>
						</PanelGroup>
					) : (
						<div className="flex flex-1 overflow-hidden">{viewContent}</div>
					)}
					<StatusBar />
				</SidebarInset>
				{showSettings && <AuthDialog onClose={() => setShowSettings(false)} />}
				{showCommandPalette && (
					<CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
				)}
				{showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
				{showSupport && <SupportDialog onClose={() => setShowSupport(false)} />}
				{gettingStarted.open && (
					<GettingStartedDialog onClose={() => gettingStarted.setOpen(false)} />
				)}
			</SidebarProvider>
		</TooltipProvider>
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
