import { levelColor } from "@/lib/log-filters";

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
						<span className="w-12 shrink-0 text-right text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
							{d.level}
						</span>
						<div className="h-4 flex-1 overflow-hidden rounded-sm bg-muted/50">
							<div
								className="h-full rounded-sm"
								style={{
									width: `${Math.max(pct, 0.5)}%`,
									background: levelColor(d.level),
								}}
							/>
						</div>
						<span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
							{pct < 1 ? "<1" : Math.round(pct)}%
						</span>
						<span className="w-16 shrink-0 text-right text-xs tabular-nums">
							{d.count.toLocaleString()}
						</span>
					</div>
				);
			})}
		</div>
	);
}
