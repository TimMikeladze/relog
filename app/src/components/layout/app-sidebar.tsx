import {
	AlertTriangle,
	Bookmark as BookmarkIcon,
	Circle,
	Command,
	FileText,
	Heart,
	LayoutDashboard,
	Lock,
	LockOpen,
	Moon,
	Rocket,
	Route,
	ScrollText,
	Search,
	Sun,
	Terminal,
	Waypoints,
	X,
	XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBookmarks } from "@/hooks/use-bookmarks";
import { useHealth } from "@/hooks/use-health";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import type { Bookmark, Filters, View } from "@/types";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";

const NAV: { id: View; label: string; icon: typeof ScrollText; shortcut: string }[] = [
	{ id: "explore", label: "Explore", icon: ScrollText, shortcut: "G E" },
	{ id: "traces", label: "Traces", icon: Waypoints, shortcut: "G T" },
	{ id: "query", label: "Query", icon: Terminal, shortcut: "G Q" },
	{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
];

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="pointer-events-none hidden shrink-0 select-none rounded border border-sidebar-border bg-sidebar-accent/60 px-1 font-mono text-[9px] leading-4 tracking-wider text-muted-foreground group-hover/menu-item:text-foreground md:inline-block">
			{children}
		</kbd>
	);
}

function IconAction({
	label,
	onClick,
	href,
	children,
}: {
	label: string;
	onClick?: () => void;
	href?: string;
	children: React.ReactNode;
}) {
	const className =
		"flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
	if (href) {
		return (
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				title={label}
				aria-label={label}
				className={className}
			>
				{children}
			</a>
		);
	}
	return (
		<button type="button" onClick={onClick} title={label} aria-label={label} className={className}>
			{children}
		</button>
	);
}

export function AppSidebar({
	currentView,
	filters,
	onViewChange,
	onUpdateFilter,
	onCommandPalette,
	onSettingsClick,
	onSupportClick,
	onGettingStartedClick,
	onBookmarkClick,
}: {
	currentView: View;
	filters: Filters;
	onViewChange: (view: View) => void;
	onUpdateFilter: (key: keyof Filters, value: string | undefined) => void;
	onCommandPalette: () => void;
	onSettingsClick: () => void;
	onSupportClick: () => void;
	onGettingStartedClick: () => void;
	onBookmarkClick?: (b: Bookmark) => void;
}) {
	const { state } = useSidebar();
	const collapsed = state === "collapsed";
	const { data: health } = useHealth(true, 15_000);
	const { bookmarks, remove } = useBookmarks();
	const { dark, toggle } = useTheme();
	const auth = useAuth();

	const authed = auth.status === "authenticated";
	const levels = new Set(filters.level?.split(",").filter(Boolean) ?? []);

	const toggleLevel = (level: string) => {
		const next = new Set(levels);
		if (next.has(level)) {
			next.delete(level);
		} else {
			next.add(level);
		}
		onUpdateFilter("level", next.size > 0 ? Array.from(next).join(",") : undefined);
	};

	const quickFilters = [
		{
			key: "error",
			label: "Errors",
			icon: XCircle,
			active: levels.has("error"),
			onClick: () => toggleLevel("error"),
			dot: "text-red-400",
		},
		{
			key: "warn",
			label: "Warnings",
			icon: AlertTriangle,
			active: levels.has("warn"),
			onClick: () => toggleLevel("warn"),
			dot: "text-amber-400",
		},
		{
			key: "bookmarked",
			label: "Bookmarked",
			icon: BookmarkIcon,
			active: filters.bookmarked === "true",
			onClick: () =>
				onUpdateFilter("bookmarked", filters.bookmarked === "true" ? undefined : "true"),
			dot: "text-primary",
		},
	];

	return (
		<Sidebar collapsible="icon" className="border-sidebar-border">
			<SidebarHeader className="gap-2 p-2">
				<div
					className={cn(
						"flex items-center gap-2 rounded-md px-1.5 py-1",
						collapsed && "justify-center px-0",
					)}
				>
					<span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
						r
						<Circle
							className={cn(
								"absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-sidebar",
								health?.ok ? "fill-emerald-400 text-emerald-400" : "fill-zinc-500 text-zinc-500",
							)}
						/>
					</span>
					{!collapsed && (
						<div className="flex min-w-0 flex-1 flex-col leading-tight">
							<span className="truncate text-xs font-semibold tracking-tight">relog.dev</span>
							<span className="truncate text-[10px] text-muted-foreground">
								{health ? `${health.log_count.toLocaleString()} logs` : "connecting…"}
							</span>
						</div>
					)}
				</div>

				<button
					type="button"
					onClick={onCommandPalette}
					title="Command palette"
					className={cn(
						"flex h-8 items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						collapsed && "w-8 justify-center px-0",
					)}
				>
					<Search className="h-3.5 w-3.5 shrink-0" />
					{!collapsed && (
						<>
							<span className="flex-1 text-left">Search…</span>
							<Kbd>
								<Command className="mb-px inline-block h-2.5 w-2.5" />K
							</Kbd>
						</>
					)}
				</button>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Observe</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV.map((item) => (
								<SidebarMenuItem key={item.id}>
									<SidebarMenuButton
										isActive={currentView === item.id}
										onClick={() => onViewChange(item.id)}
										tooltip={item.label}
										className="text-xs"
									>
										<item.icon className="h-4 w-4" />
										<span>{item.label}</span>
										<span className="ml-auto flex items-center gap-0.5 group-data-[collapsible=icon]:hidden">
											{item.shortcut.split(" ").map((k) => (
												<Kbd key={k}>{k}</Kbd>
											))}
										</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>Quick filters</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{quickFilters.map((f) => (
								<SidebarMenuItem key={f.key}>
									<SidebarMenuButton
										isActive={f.active}
										onClick={f.onClick}
										tooltip={f.label}
										className="text-xs"
									>
										<f.icon className={cn("h-4 w-4", f.active && f.dot)} />
										<span>{f.label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>

				{bookmarks.length > 0 && !collapsed && (
					<SidebarGroup>
						<SidebarGroupLabel>Saved ({bookmarks.length})</SidebarGroupLabel>
						{/* Scrolls rather than truncating — this is the only place
						    bookmarks can be opened or removed. */}
						<SidebarGroupContent className="max-h-64 overflow-y-auto">
							<SidebarMenu>
								{bookmarks.map((b) => (
									<SidebarMenuItem key={b.id}>
										<SidebarMenuButton
											onClick={() => onBookmarkClick?.(b)}
											tooltip={b.label}
											className="text-xs"
										>
											{b.type === "trace" ? (
												<Route className="h-4 w-4" />
											) : (
												<FileText className="h-4 w-4" />
											)}
											<span className="truncate">{b.label}</span>
										</SidebarMenuButton>
										<button
											type="button"
											onClick={() => remove(b.id)}
											aria-label={`Remove bookmark ${b.label}`}
											className="absolute right-1 top-1 hidden rounded p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover/menu-item:block"
										>
											<X className="h-3 w-3" />
										</button>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>

			<SidebarFooter className="gap-2 p-2">
				<button
					type="button"
					onClick={onSettingsClick}
					title={`${auth.serverUrl} — ${authed ? (auth.key ? "authenticated" : "no auth required") : "not authenticated"}`}
					className={cn(
						"flex h-8 items-center gap-2 rounded-md border border-sidebar-border px-2 text-left transition-colors hover:bg-sidebar-accent",
						collapsed && "w-8 justify-center px-0",
					)}
				>
					{authed ? (
						<Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
					) : (
						<LockOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					)}
					{!collapsed && (
						<span className="flex min-w-0 flex-1 flex-col leading-tight">
							<span className="truncate font-mono text-[10px]">
								{auth.serverUrl?.replace(/^https?:\/\//, "")}
							</span>
							<span className="truncate text-[9px] text-muted-foreground">
								{auth.isLocal ? "local" : "remote"} ·{" "}
								{authed ? (auth.key ? "authenticated" : "open") : "no auth"}
							</span>
						</span>
					)}
				</button>

				<div
					className={cn(
						"flex items-center gap-0.5",
						collapsed ? "flex-col" : "justify-between px-0.5",
					)}
				>
					<IconAction label={dark ? "Light mode" : "Dark mode"} onClick={toggle}>
						{dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
					</IconAction>
					<IconAction label="Getting started" onClick={onGettingStartedClick}>
						<Rocket className="h-3.5 w-3.5" />
					</IconAction>
					<IconAction label="GitHub" href="https://github.com/TimMikeladze/relog">
						<svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
							<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
						</svg>
					</IconAction>
					<IconAction label="Support relog.dev" onClick={onSupportClick}>
						<Heart className="h-3.5 w-3.5 text-pink-400" />
					</IconAction>
				</div>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
