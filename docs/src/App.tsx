import { useEffect, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript", "bash", "json", "jsonc", "sql"],
		});
	}
	return highlighterPromise;
}

function App() {
	return (
		<div className="min-h-screen hero-glow">
			<Header />
			<main className="max-w-2xl mx-auto px-6 pt-24 sm:pt-32 pb-16">
				<Hero />
				<Features />
				<Examples />
				<FAQ />
				<Footer />
			</main>
		</div>
	);
}

function Header() {
	return (
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl">
			<div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight">
					relog.dev
				</a>
				<nav className="flex items-center gap-5 text-[13px]">
					<a
						href="https://github.com/TimMikeladze/relog"
						className="text-muted hover:text-fg transition-colors flex items-center gap-1.5"
					>
						<GitHubIcon />
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/relog.dev"
						className="text-bg bg-fg rounded-md px-3 py-1 font-medium hover:bg-fg/85 transition-colors"
					>
						Install
					</a>
				</nav>
			</div>
		</header>
	);
}

function Hero() {
	return (
		<section className="mb-24">
			<p className="text-muted text-[13px] tracking-wide mb-5">Open source &middot; MIT</p>
			<h1 className="text-[2.75rem] sm:text-5xl font-bold tracking-[-0.035em] leading-[1.08] mb-5">
				Structured logging
				<br />
				<span className="gradient-agent">for the agentic era.</span>
			</h1>
			<p className="text-dim text-[15px] leading-[1.7] mb-10 max-w-md">
				Self-hosted log server backed by SQLite. Ship structured logs from any app, query with SQL,
				stream in real-time, and let AI agents analyze everything via MCP.
			</p>
			<CodeBlock lang="bash" code={`bunx relog.dev start`} />
		</section>
	);
}

function Features() {
	const features = [
		{
			color: "bg-accent",
			label: "Zero-dependency server",
			desc: "Single SQLite file, no Redis, no Postgres, no external infra",
		},
		{
			color: "bg-cyan",
			label: "AI agent integration",
			desc: "Built-in MCP server for Claude Code, Cursor, and any MCP client",
		},
		{
			color: "bg-emerald",
			label: "Query with SQL",
			desc: "Run arbitrary SELECT statements directly against your logs",
		},
		{
			color: "bg-rose",
			label: "Drop-in Next.js support",
			desc: "Console capture, request tracing, error tracking, browser proxy",
		},
		{
			color: "bg-amber",
			label: "Distributed tracing",
			desc: "Propagate trace_id and span_id across every service",
		},
		{
			color: "bg-accent",
			label: "Real-time tail",
			desc: "Stream logs via SSE with server-side level, service, and project filters",
		},
		{
			color: "bg-emerald",
			label: "S3 + Parquet archival",
			desc: "Archive to S3 and query hot + cold logs with DuckDB",
		},
		{
			color: "bg-rose",
			label: "Browser logging",
			desc: "Client-side SDK with session tracking, error capture, and proxy delivery",
		},
		{
			color: "bg-cyan",
			label: "Role-based auth",
			desc: "Three tiers — ingest, read, admin — with Bearer token auth on every route",
		},
		{
			color: "bg-amber",
			label: "Full CLI toolkit",
			desc: "Tail, search, query, stats, export, and prune from the terminal",
		},
	];

	return (
		<section className="mb-24">
			<div className="grid sm:grid-cols-2 gap-x-16 gap-y-5">
				{features.map((f) => (
					<div key={f.label} className="flex items-start gap-3">
						<span className={`mt-[7px] block w-1.5 h-1.5 rounded-full ${f.color} shrink-0`} />
						<div>
							<p className="text-sm font-medium text-fg">{f.label}</p>
							<p className="text-[13px] text-muted">{f.desc}</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function Examples() {
	const [tab, setTab] = useState(0);

	const tabs = [
		{ label: "SDK", color: "bg-accent" },
		{ label: "Next.js", color: "bg-rose" },
		{ label: "Browser", color: "bg-cyan" },
		{ label: "Auth", color: "bg-amber" },
		{ label: "MCP", color: "bg-emerald" },
		{ label: "Archive", color: "bg-emerald" },
		{ label: "CLI", color: "bg-accent" },
	];

	const examples = [
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";

const log = createLogger({
  url: "http://localhost:3485",
  service: "api",
});

log.info("server started", { port: 3000 });
log.warn("slow query", { duration_ms: 1200 });
log.error(new Error("connection failed"));

// Distributed tracing with child loggers
const reqLog = log.child({ traceId: "abc-123" });
reqLog.info("request started", { method: "POST", path: "/users" });
reqLog.error(new Error("validation failed"));

await log.flush();`,
		},
		{
			lang: "typescript",
			code: `// app/api/relog/route.ts — proxy for browser logs
import { createBrowserProxy } from "relog.dev/next";

export const POST = createBrowserProxy({
  url: process.env.RELOG_URL,
  auth: process.env.RELOG_AUTH,
  service: "my-nextjs-app",
});

// instrumentation.ts — captures console + errors
import { createRelog } from "relog.dev/next";

const relog = createRelog({
  url: "http://localhost:3485",
  service: "my-nextjs-app",
});

export async function register() {
  await relog.register();
}

export const onRequestError = relog.onRequestError;

// proxy.ts — logs every request with trace IDs
import { relogProxy } from "relog.dev/next";

export const proxy = relogProxy();`,
		},
		{
			lang: "typescript",
			code: `import { init } from "relog.dev/browser";

// Logs are sent to /api/relog on the same origin by default.
// A server-side proxy forwards them to your relog server,
// keeping your ingest key out of client-side code.
// You can skip the proxy by pointing endpoint directly at
// your relog server, but your ingest key will be exposed.
const log = init({
  service: "web-app",
  captureConsole: true,
  captureErrors: true,
});

log.info("page loaded", { route: location.pathname });

// app/api/relog/route.ts — the proxy route
import { createBrowserProxy } from "relog.dev/next";
export const POST = createBrowserProxy({
  url: process.env.RELOG_URL,
  auth: process.env.RELOG_AUTH,
});`,
		},
		{
			lang: "bash",
			code: `# Three roles: ingest (write) < read (query) < admin (all)
bunx relog.dev start \\
  --ingest-key ik_prod_abc123 \\
  --read-key rk_prod_xyz789 \\
  --admin-key ak_prod_secret456

curl -X POST http://localhost:3485/ingest \\
  -H "Authorization: Bearer ik_prod_abc123" \\
  -H "Content-Type: application/json" \\
  -d '[{"level":"info","message":"deployed","service":"api"}]'`,
		},
		{
			lang: "json",
			code: `// ~/.claude/settings.json
{
  "mcpServers": {
    "relog.dev": {
      "command": "npx",
      "args": [
        "relog.dev", "mcp",
        "--url", "http://localhost:3485",
        "--auth", "rk_your_read_key"
      ]
    }
  }
}`,
		},
		{
			lang: "bash",
			code: `# Archive logs older than 7 days to S3 as Parquet
bunx relog.dev archive --keep-days 7

# Start server with S3 config for unified hot + cold queries
bunx relog.dev start \\
  --s3-endpoint https://s3.amazonaws.com \\
  --s3-bucket my-logs \\
  --s3-access-key AKIA... \\
  --s3-secret-key ...

# DuckDB merges SQLite (hot) + S3 Parquet (cold) seamlessly
# — queries and search work across both storages`,
		},
		{
			lang: "bash",
			code: `bunx relog.dev tail --level error --service api

bunx relog.dev search --grep "payment failed" --from 1h

bunx relog.dev query --sql \\
  "SELECT service, level, COUNT(*) as n
   FROM logs GROUP BY service, level"

bunx relog.dev export --format csv --from 7d`,
		},
	];

	return (
		<section className="mb-24">
			<div className="flex items-center gap-1 mb-5 overflow-x-auto">
				{tabs.map((t, i) => (
					<button
						key={t.label}
						onClick={() => setTab(i)}
						className={`inline-flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer ${
							tab === i ? "text-fg bg-white/[0.06]" : "text-muted hover:text-dim"
						}`}
					>
						<span
							className={`block w-1.5 h-1.5 rounded-full ${t.color} ${tab === i ? "opacity-100" : "opacity-30"}`}
						/>
						{t.label}
					</button>
				))}
			</div>
			<CodeBlock lang={examples[tab]!.lang} code={examples[tab]!.code} />
		</section>
	);
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState("");

	useEffect(() => {
		getHighlighter().then((h) => {
			setHtml(
				h.codeToHtml(code, {
					lang: lang === "json" && code.startsWith("//") ? "jsonc" : lang,
					theme: "github-dark-default",
				}),
			);
		});
	}, [code, lang]);

	return (
		<div className="rounded-lg border border-border overflow-hidden">
			{html ? (
				<div
					className="[&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:text-[13px] [&_pre]:leading-[1.7] [&_pre]:!bg-bg-code [&_code]:font-mono"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="p-5 overflow-x-auto bg-bg-code text-[13px] leading-[1.7]">
					<code className="text-fg/70 font-mono">{code}</code>
				</pre>
			)}
		</div>
	);
}

function FAQ() {
	const faqs = [
		{
			q: "Why not Datadog / Logtail / Axiom?",
			a: "Free, self-hosted, MIT licensed. No per-GB fees, no third-party data sharing.",
		},
		{
			q: "How does storage work?",
			a: "Single SQLite file with WAL mode. Indexed by level, service, project, branch, trace ID, and timestamp.",
		},
		{
			q: "What does the MCP server do?",
			a: "Lets AI agents like Claude Code and Cursor search, query, and analyze your logs through tool use.",
		},
		{
			q: "How does archival work?",
			a: "Archive old logs to S3 as Parquet files with a single CLI command. DuckDB transparently queries both hot logs in SQLite and cold logs in S3, so search and SQL work across your entire history without loading everything into memory.",
		},
		{
			q: "Does it support authentication?",
			a: "Three hierarchical roles: ingest, read, admin. Bearer token auth on all endpoints.",
		},
	];

	return (
		<section className="mb-24">
			<div className="space-y-6">
				{faqs.map((f) => (
					<div key={f.q}>
						<p className="text-sm font-medium text-fg mb-1">{f.q}</p>
						<p className="text-[13px] text-muted leading-relaxed">{f.a}</p>
					</div>
				))}
			</div>
		</section>
	);
}

function Footer() {
	return (
		<footer className="border-t border-border pt-8">
			<div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
				<div className="flex items-center gap-4">
					<a
						href="https://github.com/TimMikeladze/relog"
						className="hover:text-fg transition-colors"
					>
						GitHub
					</a>
					<a
						href="https://www.npmjs.com/package/relog.dev"
						className="hover:text-fg transition-colors"
					>
						npm
					</a>
					<a
						href="https://github.com/TimMikeladze/relog/releases"
						className="hover:text-fg transition-colors"
					>
						Releases
					</a>
				</div>
				<div className="flex items-center gap-4">
					<a href="https://x.com/linesofcode" className="hover:text-fg transition-colors">
						X
					</a>
					<a
						href="https://bsky.app/profile/linesofcode.bsky.social"
						className="hover:text-fg transition-colors"
					>
						Bluesky
					</a>
				</div>
			</div>
			<p className="text-muted/30 text-xs mt-6 pb-6">&copy; {new Date().getFullYear()} relog.dev</p>
		</footer>
	);
}

function GitHubIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

export default App;
