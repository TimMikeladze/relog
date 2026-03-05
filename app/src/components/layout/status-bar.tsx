import { useHealth } from "@/hooks/use-health";
import { Circle } from "lucide-react";

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

export function StatusBar() {
	const { data: health } = useHealth(true, 15_000);

	return (
		<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-1 text-[10px] text-muted-foreground font-mono">
			<div className="flex items-center gap-1.5">
				<Circle
					className={`h-1.5 w-1.5 ${health?.ok ? "fill-emerald-400 text-emerald-400" : "fill-zinc-400 text-zinc-400"}`}
				/>
				<span>{health?.ok ? "Connected" : "Disconnected"}</span>
			</div>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `${health.log_count.toLocaleString()} logs` : "\u2014"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `db: ${formatBytes(health.db_size_bytes)}` : "\u2014"}</span>
			<div className="h-3 w-px bg-border" />
			<span>{health ? `up ${formatUptime(health.uptime)}` : "\u2014"}</span>
		</div>
	);
}
