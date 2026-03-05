const levelColors: Record<string, string> = {
	trace: "bg-zinc-400",
	debug: "bg-blue-400",
	info: "bg-emerald-400",
	warn: "bg-amber-400",
	error: "bg-red-400",
	fatal: "bg-fuchsia-400",
};

interface LevelCount {
	level: string;
	count: number;
}

export function LevelChart({ data }: { data: LevelCount[] }) {
	const total = data.reduce((s, d) => s + d.count, 0);
	if (total === 0) {
		return <span className="text-xs text-muted-foreground italic">No data</span>;
	}

	const sorted = [...data].sort((a, b) => b.count - a.count);

	return (
		<div className="space-y-2">
			{sorted.map((d) => {
				const pct = (d.count / total) * 100;
				return (
					<div key={d.level} className="flex items-center gap-3">
						<span className="w-12 shrink-0 text-right font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							{d.level}
						</span>
						<div className="flex-1 h-4 rounded-sm bg-muted/50 overflow-hidden">
							<div
								className={`h-full rounded-sm transition-all ${levelColors[d.level] ?? "bg-muted-foreground"}`}
								style={{ width: `${Math.max(pct, 0.5)}%` }}
							/>
						</div>
						<span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
							{pct < 1 ? "<1" : Math.round(pct)}%
						</span>
						<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">
							{d.count.toLocaleString()}
						</span>
					</div>
				);
			})}
		</div>
	);
}
