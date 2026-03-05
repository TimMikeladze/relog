import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail?: string;
}) {
	return (
		<Card size="sm">
			<CardContent className="flex flex-col gap-1">
				<span className="text-2xl font-semibold tracking-tight">{value}</span>
				<span className="text-xs text-muted-foreground">{label}</span>
				{detail && <span className="text-[10px] text-muted-foreground/70">{detail}</span>}
			</CardContent>
		</Card>
	);
}
