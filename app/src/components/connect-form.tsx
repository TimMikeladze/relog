import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";

export function ConnectForm() {
	const { serverUrl, status, key, error, login, logout, setServerUrl } = useAuth();
	const [urlInput, setUrlInput] = useState(serverUrl || "http://localhost:3485");
	const [keyInput, setKeyInput] = useState("");
	const connected = status === "authenticated";

	const handleConnect = () => {
		setServerUrl(urlInput);
		if (keyInput) login(keyInput);
	};

	return (
		<div className="space-y-2">
			{!connected && (
				<div className="flex gap-2">
					<div className="flex flex-1 gap-0">
						<input
							type="text"
							value={urlInput}
							onChange={(e) => setUrlInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleConnect();
							}}
							placeholder="http://localhost:3485"
							className="h-7 flex-1 min-w-0 rounded-l-md border border-r-0 border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
						/>
						<input
							type="password"
							value={keyInput}
							onChange={(e) => setKeyInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleConnect();
							}}
							placeholder="API key..."
							className="h-7 w-28 border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
						/>
					</div>
					<button
						type="button"
						onClick={handleConnect}
						className="h-7 rounded-md bg-secondary px-3 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 cursor-pointer shrink-0"
					>
						Connect
					</button>
				</div>
			)}
			{connected && (
				<div className="flex items-center gap-2">
					<span className="flex-1 truncate text-xs text-status-good">Connected to {serverUrl}</span>
					{key && (
						<button
							type="button"
							onClick={logout}
							className="text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
						>
							logout
						</button>
					)}
				</div>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}
		</div>
	);
}
