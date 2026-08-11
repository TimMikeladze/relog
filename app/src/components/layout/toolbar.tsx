import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The 24px controls that sit in the strip under the timeline. Shared by
 * Explore and Traces so the two views don't drift into slightly different
 * paddings and type sizes for the same buttons.
 */
export function ToolbarButton({
	onClick,
	icon: Icon,
	active,
	activeClassName,
	title,
	children,
}: {
	onClick: () => void;
	icon: ComponentType<{ className?: string }>;
	active?: boolean;
	activeClassName?: string;
	title?: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={active}
			className={cn(
				"flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium",
				active
					? (activeClassName ?? "bg-accent text-foreground")
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
		>
			<Icon className="size-3" />
			{children}
		</button>
	);
}

/** Inset track for a set of mutually exclusive icon toggles. */
export function ToolbarSegments({ children }: { children: ReactNode }) {
	return (
		<div className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted p-0.5">{children}</div>
	);
}

export function ToolbarSegment({
	active,
	onClick,
	title,
	icon: Icon,
}: {
	active: boolean;
	onClick: () => void;
	title: string;
	icon: ComponentType<{ className?: string }>;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={active}
			className={cn(
				"flex size-5 items-center justify-center rounded-[5px]",
				active
					? "bg-background text-foreground shadow-xs"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<Icon className="size-3" />
		</button>
	);
}

/** Live toggle styling, shared so "on" looks identical on both log views. */
export const LIVE_ACTIVE_CLASS = "bg-status-good/15 text-status-good";
