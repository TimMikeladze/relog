import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
	page,
	total,
	limit,
	onPageChange,
}: {
	page: number;
	total: number;
	limit: number;
	onPageChange: (page: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / limit));

	if (totalPages <= 1) return null;

	return (
		<div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2">
			<span className="text-xs text-muted-foreground">
				Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total.toLocaleString()}{" "}
				results
			</span>
			<div className="flex items-center gap-1">
				<button
					type="button"
					disabled={page <= 1}
					onClick={() => onPageChange(page - 1)}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
				>
					<ChevronLeft className="h-4 w-4" />
				</button>
				<span className="px-2 text-xs tabular-nums">
					{page} / {totalPages}
				</span>
				<button
					type="button"
					disabled={page >= totalPages}
					onClick={() => onPageChange(page + 1)}
					className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
				>
					<ChevronRight className="h-4 w-4" />
				</button>
			</div>
		</div>
	);
}
