import { useState } from "react";
import * as icons from "lucide-react";
import { Check, ChevronDown, LayoutDashboard, Plus, Settings2, Trash2 } from "lucide-react";
import type { Dashboard } from "@/types";

/**
 * Dashboards declare their icon by lucide name so a dashboard created through
 * the API can pick one without the client shipping a mapping table. An
 * unknown name falls back rather than throwing — a dashboard is not broken
 * because someone typed the wrong icon.
 */
export function DashboardIcon({ name, className }: { name?: string; className?: string }) {
	const Component =
		name && name in icons
			? (icons[name as keyof typeof icons] as React.ComponentType<{ className?: string }>)
			: LayoutDashboard;
	if (typeof Component !== "function" && typeof Component !== "object") {
		return <LayoutDashboard className={className} />;
	}
	return <Component className={className} />;
}

export function DashboardPicker({
	dashboards,
	activeId,
	onSelect,
	onCreate,
	onEdit,
	onDelete,
	canEdit,
}: {
	dashboards: Dashboard[];
	activeId: string;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onEdit: (d: Dashboard) => void;
	onDelete: (d: Dashboard) => void;
	canEdit: boolean;
}) {
	const [open, setOpen] = useState(false);
	const active = dashboards.find((d) => d.id === activeId);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium"
				aria-haspopup="menu"
				aria-expanded={open}
			>
				<DashboardIcon name={active?.icon} className="h-3.5 w-3.5" />
				<span className="max-w-40 truncate">{active?.name ?? "Dashboard"}</span>
				<ChevronDown className="h-3 w-3 text-muted-foreground" />
			</button>

			{open && (
				<>
					{/* Click-away layer. Rendered as a sibling rather than an onBlur
					    handler so clicking a menu item doesn't race the close. */}
					<button
						type="button"
						aria-label="Close dashboard menu"
						className="fixed inset-0 z-40 cursor-default"
						onClick={() => setOpen(false)}
					/>
					<div className="absolute left-0 z-50 mt-1 w-72 rounded-md border border-border bg-popover p-1 shadow-md">
						{dashboards.map((d) => (
							<div
								key={d.id}
								className={`group flex items-center gap-1 rounded-sm px-1 ${
									d.id === activeId ? "bg-muted" : "hover:bg-muted/60"
								}`}
							>
								<button
									type="button"
									onClick={() => {
										onSelect(d.id);
										setOpen(false);
									}}
									className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
								>
									<DashboardIcon name={d.icon} className="h-3.5 w-3.5 shrink-0" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-medium">{d.name}</span>
										{d.description && (
											<span className="block truncate text-[10px] text-muted-foreground">
												{d.description}
											</span>
										)}
									</span>
									{d.id === activeId && <Check className="h-3 w-3 shrink-0" />}
								</button>
								{canEdit && !d.builtin && (
									<span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
										<button
											type="button"
											title="Edit dashboard"
											onClick={() => {
												onEdit(d);
												setOpen(false);
											}}
											className="rounded p-1 hover:bg-muted"
										>
											<Settings2 className="h-3 w-3" />
										</button>
										<button
											type="button"
											title="Delete dashboard"
											onClick={() => {
												onDelete(d);
												setOpen(false);
											}}
											className="rounded p-1 text-destructive hover:bg-destructive/10"
										>
											<Trash2 className="h-3 w-3" />
										</button>
									</span>
								)}
							</div>
						))}

						{canEdit && (
							<>
								<div className="my-1 h-px bg-border" />
								<button
									type="button"
									onClick={() => {
										onCreate();
										setOpen(false);
									}}
									className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"
								>
									<Plus className="h-3.5 w-3.5" /> New dashboard
								</button>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
