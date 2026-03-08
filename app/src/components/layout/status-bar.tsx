import { useHealth } from "@/hooks/use-health";
import { useAuth } from "@/hooks/use-auth";
import { Circle, Heart, Lock, LockOpen, Rocket } from "lucide-react";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function StatusBar({
	onSettingsClick,
	onSupportClick,
	onGettingStartedClick,
}: {
	onSettingsClick?: () => void;
	onSupportClick?: () => void;
	onGettingStartedClick?: () => void;
}) {
	const { data: health } = useHealth(true, 15_000);
	const auth = useAuth();

	const authed = auth.status === "authenticated";
	const { isLocal } = auth;

	return (
		<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1 text-[10px] text-muted-foreground">
			<div className="flex items-center gap-1.5">
				<Circle
					className={`h-1.5 w-1.5 ${health?.ok ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
				/>
				<span>{health?.ok ? "Connected" : "Disconnected"}</span>
			</div>
			{isLocal && (
				<>
					<div className="h-3 w-px bg-border" />
					<span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400 border border-emerald-500/20">
						local
					</span>
				</>
			)}
			<div className="h-3 w-px bg-border" />
			<button
				type="button"
				onClick={onSettingsClick}
				className="flex items-center gap-2 rounded px-1 -mx-1 cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
			>
				<span className="font-mono">{auth.serverUrl}</span>
				<div className="h-3 w-px bg-border" />
				<div className="flex items-center gap-1">
					{authed ? (
						<Lock className="h-2.5 w-2.5 text-emerald-400" />
					) : (
						<LockOpen className="h-2.5 w-2.5" />
					)}
					<span>
						{authed ? (auth.key ? "Authenticated" : "No auth required") : "Not authenticated"}
					</span>
				</div>
			</button>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `${health.log_count.toLocaleString()} logs` : "\u2014"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `db: ${formatBytes(health.db_size_bytes)}` : "\u2014"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `up ${formatUptime(health.uptime)}` : "\u2014"}</span>
			<div className="flex-1" />
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={onGettingStartedClick}
					title="Getting started"
					className="rounded p-1 cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
				>
					<Rocket className="h-3 w-3" />
				</button>
				<a
					href="https://github.com/TimMikeladze/relog"
					target="_blank"
					rel="noopener noreferrer"
					className="rounded p-1 cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="h-3 w-3 fill-current">
						<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
					</svg>
				</a>
				<button
					type="button"
					onClick={onSupportClick}
					className="rounded p-1 cursor-pointer transition-colors hover:bg-muted hover:text-foreground"
				>
					<Heart className="h-3 w-3 text-pink-400" />
				</button>
			</div>
		</div>
	);
}
