import { useState, useEffect } from "react";
import { Check, Copy, X, Rocket } from "lucide-react";
import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki";
import { useAuth } from "@/hooks/use-auth";
import { ConnectForm } from "@/components/connect-form";

const DISMISSED_KEY = "relog:onboarding-dismissed";

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript", "bash", "json"],
		});
	}
	return highlighterPromise;
}

type TokenLine = { content: string; color?: string }[];

export function useGettingStarted() {
	const [open, setOpen] = useState(() => {
		try {
			return !localStorage.getItem(DISMISSED_KEY);
		} catch {
			return true;
		}
	});

	const dismiss = () => {
		// Best-effort: if localStorage is full or unavailable (Safari private
		// mode, quota exceeded), still dismiss the dialog for this session
		// rather than throwing out of the click handler.
		try {
			localStorage.setItem(DISMISSED_KEY, "1");
		} catch (err) {
			console.warn("[relog] could not persist onboarding dismissal:", err);
		}
		setOpen(false);
	};

	return { open, setOpen, dismiss };
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: BundledLanguage }) {
	const [copied, setCopied] = useState(false);
	const [lines, setLines] = useState<TokenLine[] | null>(null);
	const [bg, setBg] = useState<string | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		getHighlighter().then((h) => {
			if (cancelled) return;
			const result = h.codeToTokensBase(code, { lang, theme: "github-dark-default" });
			const theme = h.getTheme("github-dark-default");
			if (!cancelled) {
				setLines(result);
				setBg(theme.bg);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	const handleCopy = () => {
		navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="group relative rounded-md border border-border overflow-hidden">
			{lines ? (
				<pre
					className="overflow-x-auto p-3 pr-9 text-[11px] leading-relaxed font-mono"
					style={{ backgroundColor: bg }}
				>
					{lines.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: line index is stable for static code
						<div key={i}>
							{line.map((token, j) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: token index is stable for static code
								<span key={j} style={{ color: token.color }}>
									{token.content}
								</span>
							))}
							{line.length === 0 && "\n"}
						</div>
					))}
				</pre>
			) : (
				<pre className="overflow-x-auto p-3 pr-9 text-[11px] leading-relaxed font-mono text-foreground bg-muted/60">
					<code>{code}</code>
				</pre>
			)}
			<button
				type="button"
				onClick={handleCopy}
				aria-label="Copy code"
				className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground cursor-pointer"
			>
				{copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
			</button>
		</div>
	);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground shrink-0">
					{n}
				</span>
				<span className="text-xs font-medium">{title}</span>
			</div>
			<div className="pl-6">{children}</div>
		</div>
	);
}

export function GettingStartedDialog({ onClose }: { onClose: () => void }) {
	const { isLocal, serverUrl, status } = useAuth();

	const serverUrlForSnippet = isLocal ? "http://localhost:3485" : serverUrl;
	const serverRunning = isLocal && status === "authenticated";
	const needsConnect = !serverRunning;
	const connectStep = needsConnect ? 2 : null;
	const sendLogsStep = needsConnect ? 3 : 2;

	const handleDismiss = () => {
		localStorage.setItem(DISMISSED_KEY, "1");
		onClose();
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-lg max-h-[85vh] flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
					<div className="flex items-center gap-2">
						<Rocket className="h-3.5 w-3.5 text-muted-foreground" />
						<span className="text-sm font-semibold">get started</span>
					</div>
					<div className="flex items-center gap-2">
						{isLocal && (
							<span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
								local
							</span>
						)}
						<button
							type="button"
							onClick={handleDismiss}
							className="rounded p-1 cursor-pointer text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				</div>

				{/* Body */}
				<div className="overflow-y-auto p-5 space-y-5">
					<Step n={1} title="install">
						<div className="space-y-2">
							<CodeBlock
								lang="bash"
								code={`bun add relog.dev\n\n# optional: run your own server at http://localhost:3485\nbun relog.dev start`}
							/>
						</div>
					</Step>

					{needsConnect && (
						<Step n={connectStep!} title="connect to a local or remote server">
							<ConnectForm />
						</Step>
					)}

					<Step n={sendLogsStep} title="send logs with the TypeScript client">
						<div className="space-y-2">
							<CodeBlock
								lang="typescript"
								code={`import { createLogger } from "relog.dev";

const log = createLogger({
  url: "${serverUrlForSnippet}/ingest",
});

log.info("Hello, relog!", { service: "my-app" });
log.error("Something went wrong", { code: 500 });`}
							/>
						</div>
					</Step>

					<Step n={sendLogsStep + 1} title="or send via HTTP">
						<CodeBlock
							lang="bash"
							code={`curl -X POST ${serverUrlForSnippet}/ingest \\
  -H "Content-Type: application/json" \\
  -d '[{"level":"info","message":"Hello, relog!"}]'`}
						/>
					</Step>

					<Step n={sendLogsStep + 2} title="explore your logs">
						<p className="text-xs text-muted-foreground">
							Logs appear in the <strong className="text-foreground">Explore</strong> view in
							real-time. Use the sidebar to filter by level, service, or project.
						</p>
					</Step>

					<Step n={sendLogsStep + 3} title="connect your agent via mcp">
						<div className="space-y-2">
							<p className="text-xs text-muted-foreground">
								Add this to your Claude Desktop{" "}
								<code className="font-mono">claude_desktop_config.json</code> to query logs directly
								from Claude.
							</p>
							<CodeBlock
								lang="json"
								code={`{
  "mcpServers": {
    "relog": {
      "command": "bun",
      "args": ["relog.dev", "mcp", "--url", "${serverUrlForSnippet}"]
    }
  }
}`}
							/>
						</div>
					</Step>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-border px-5 py-3 shrink-0">
					<a
						href="https://github.com/TimMikeladze/relog"
						target="_blank"
						rel="noopener noreferrer"
						className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
					>
						full docs on github →
					</a>
					<button
						type="button"
						onClick={handleDismiss}
						className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
					>
						don't show again
					</button>
				</div>
			</div>
		</div>
	);
}
