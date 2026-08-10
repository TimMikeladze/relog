import { useHealth } from "@/hooks/use-health";
import { Circle } from "lucide-react";

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** `/health` reports uptime in seconds, not milliseconds. */
function formatUptime(uptimeSeconds: number): string {
	const seconds = Math.floor(uptimeSeconds);
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center gap-1">
			<span className="text-muted-foreground/60">{label}</span>
			<span className="tabular-nums">{value}</span>
		</div>
	);
}

/**
 * Bottom metrics strip. Server/auth details and app actions live in the
 * sidebar footer — this bar stays a read-only health readout.
 */
export function StatusBar() {
	const { data: health } = useHealth(true, 15_000);

	return (
		<div className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-muted-foreground">
			<div className="flex items-center gap-1.5">
				<Circle
					className={`h-1.5 w-1.5 ${health?.ok ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
				/>
				<span>{health?.ok ? "Connected" : "Disconnected"}</span>
			</div>
			<div className="h-3 w-px bg-border" />
			<Stat label="logs" value={health ? health.log_count.toLocaleString() : "—"} />
			<div className="h-3 w-px bg-border" />
			<Stat label="db" value={health ? formatBytes(health.db_size_bytes) : "—"} />
			<div className="h-3 w-px bg-border" />
			<Stat label="up" value={health ? formatUptime(health.uptime) : "—"} />
			<div className="flex-1" />
			{health?.auto_prune?.db_usage_pct !== undefined && (
				<Stat label="capacity" value={`${Math.round(health.auto_prune.db_usage_pct)}%`} />
			)}
		</div>
	);
}
