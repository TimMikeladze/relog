import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { X } from "lucide-react";

export function AuthDialog({ onClose }: { onClose: () => void }) {
	const { status, key, serverUrl, error, login, logout, setServerUrl } = useAuth();
	const [keyInput, setKeyInput] = useState("");
	const [urlInput, setUrlInput] = useState(serverUrl);
	const isModal = status === "needs-auth";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-sm font-semibold">Settings</h2>
					{!isModal && (
						<button
							type="button"
							onClick={onClose}
							className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					)}
				</div>

				{error && (
					<div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
						{error}
					</div>
				)}

				<div className="space-y-4">
					<div>
						<label className="mb-1.5 block text-xs text-muted-foreground">Server URL</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={urlInput}
								onChange={(e) => setUrlInput(e.target.value)}
								className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
							/>
							<button
								type="button"
								onClick={() => setServerUrl(urlInput)}
								className="h-8 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
							>
								Connect
							</button>
						</div>
					</div>

					{status === "needs-auth" || !key ? (
						<div>
							<label className="mb-1.5 block text-xs text-muted-foreground">API Key</label>
							<div className="flex gap-2">
								<input
									type="password"
									value={keyInput}
									onChange={(e) => setKeyInput(e.target.value)}
									placeholder="Enter read key..."
									onKeyDown={(e) => {
										if (e.key === "Enter" && keyInput) login(keyInput);
									}}
									className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
								/>
								<button
									type="button"
									onClick={() => keyInput && login(keyInput)}
									disabled={!keyInput}
									className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
								>
									Login
								</button>
							</div>
						</div>
					) : (
						<div>
							<label className="mb-1.5 block text-xs text-muted-foreground">API Key</label>
							<div className="flex items-center gap-2">
								<span className="flex-1 truncate font-mono text-xs text-muted-foreground">
									{key.slice(0, 8)}
									{"..."}
								</span>
								<button
									type="button"
									onClick={logout}
									className="h-8 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
								>
									Logout
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
