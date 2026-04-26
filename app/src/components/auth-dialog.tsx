import { useAuth } from "@/hooks/use-auth";
import { Settings, X } from "lucide-react";
import { ConnectForm } from "@/components/connect-form";

export function AuthDialog({ onClose }: { onClose?: () => void }) {
	const { status } = useAuth();
	// In needs-auth mode the dialog is a hard gate — there's nowhere to
	// close it back to. We hide the close affordances entirely so callers
	// can pass `undefined` (or omit `onClose`) without rendering a button
	// that does nothing.
	const isModal = status === "needs-auth" || !onClose;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-lg max-h-[85vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
					<div className="flex items-center gap-2">
						<Settings className="h-3.5 w-3.5 text-muted-foreground" />
						<span className="text-sm font-semibold">settings</span>
					</div>
					{!isModal && (
						<button
							type="button"
							onClick={onClose}
							className="rounded p-1 cursor-pointer text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					)}
				</div>

				{/* Body */}
				<div className="overflow-y-auto p-5 space-y-5">
					<div className="space-y-2">
						<span className="text-xs font-medium">connection</span>
						<ConnectForm />
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end border-t border-border px-5 py-3 shrink-0">
					{!isModal && (
						<button
							type="button"
							onClick={onClose}
							className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
						>
							close
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
