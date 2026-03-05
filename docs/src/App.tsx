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
		<div className="min-h-screen hero-glow dot-pattern">
			<Header />
			<main className="max-w-5xl mx-auto px-5 sm:px-8 pt-20 sm:pt-24 pb-10">
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
		<header className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-xl border-b border-border/50">
			<div className="max-w-5xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between">
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
		<section className="mb-14 sm:mb-18">
			<p className="text-muted text-[13px] tracking-wide mb-4">Open source &middot; MIT</p>
			<h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.5rem] font-bold tracking-[-0.035em] leading-[1.08] mb-4">
				Structured logging
				<br />
				<span className="gradient-agent">for the agentic era.</span>
			</h1>
			<p className="text-dim text-[15px] sm:text-base leading-[1.7] mb-6 max-w-lg">
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
			color: "bg-cyan",
			label: "Wide events",
			desc: "Build one event per request with all context, auto-capture from req/res, emit at the end",
		},
		{
			color: "bg-amber",
			label: "Tail sampling",
			desc: "Keep all errors and slow requests, sample the rest — decided after the event completes",
		},
		{
			color: "bg-emerald",
			label: "Deployment context",
			desc: "First-class version and deployment_id fields, filterable across all endpoints",
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
		<section className="mb-14 sm:mb-18">
			<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-4">
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
		{
			label: "SDK",
			color: "bg-accent",
			title: "Client SDK",
			desc: "Ship structured logs from any TypeScript app with automatic batching, retries, and child loggers for distributed tracing.",
		},
		{
			label: "Wide Events",
			color: "bg-cyan",
			title: "Wide Events",
			desc: "Build one rich event per request — attach context as you go, auto-capture HTTP details, and emit everything at the end with tail sampling.",
		},
		{
			label: "Sampling",
			color: "bg-amber",
			title: "Tail Sampling",
			desc: "Decide what to keep after the event completes. Errors and slow requests are always kept. Normal traffic is sampled at the rate you set.",
		},
		{
			label: "Next.js",
			color: "bg-rose",
			title: "Next.js Integration",
			desc: "Drop-in instrumentation that captures console output, tracks errors, logs every request with trace IDs, and proxies browser logs.",
		},
		{
			label: "Browser",
			color: "bg-cyan",
			title: "Browser Logging",
			desc: "Client-side SDK that captures console output and errors. Use your ingest key directly, or optionally proxy through your backend to keep keys server-side.",
		},
		{
			label: "Auth",
			color: "bg-amber",
			title: "Authentication",
			desc: "Three hierarchical roles — ingest (write), read (query), admin (all) — with Bearer token auth on every route.",
		},
		{
			label: "MCP",
			color: "bg-emerald",
			title: "MCP Server",
			desc: "Let Claude Code, Cursor, and any MCP client search, query, and analyze your logs through natural tool use.",
		},
		{
			label: "Archive",
			color: "bg-emerald",
			title: "S3 Archival",
			desc: "Archive old logs to S3 as Parquet files. DuckDB transparently queries both hot (SQLite) and cold (S3) storage.",
		},
		{
			label: "CLI",
			color: "bg-accent",
			title: "CLI Toolkit",
			desc: "Tail, search, query, export, and manage logs from the terminal. Real-time streaming with server-side filters.",
		},
	];

	const examples = [
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";

const log = createLogger({
  url: "http://localhost:3485",
  service: "api",
});

// Structured key-value pairs on every log
log.info("server started", { port: 3000 });
log.warn("slow query", { duration_ms: 1200, table: "users" });
log.error(new Error("connection failed"));

// Child loggers inherit + extend context — perfect for tracing
const reqLog = log.child({
  traceId: "abc-123",
  method: "POST",
  path: "/users",
});
reqLog.info("request started");
reqLog.info("auth passed", { userId: "u_42" });
reqLog.error(new Error("validation failed"));

// Flush before shutdown to ensure delivery
await log.flush();`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";

const log = createLogger({
  url: "http://localhost:3485",
  service: "api",
  sampleRate: 0.05,       // keep 5% of normal traffic
  slowThresholdMs: 500,   // always keep slow events
});

// One event per request — accumulate context, emit once
const ev = log.event("http_request");

// Auto-extract method, path, headers, user-agent
ev.request(req);

// Add context as the request progresses
const user = await authenticate(req);
ev.set("user_id", user.id);
ev.set("org_id", user.orgId);

// Force-keep VIP traffic regardless of sample rate
if (user.tier === "enterprise") ev.keep();

try {
  const result = await handleRequest(req);
  ev.set("result_count", result.items.length);
  ev.response(res); // auto-extracts status, content-length
} catch (err) {
  ev.error(err); // errors always bypass sampling
}

// Sampling decision + emit happens here
// Duration is tracked automatically from event creation
ev.end();`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";

const log = createLogger({
  url: "http://localhost:3485",
  service: "api",
  version: "1.2.3",
  deploymentId: "deploy-abc",
  sampleRate: 0.05,       // keep 5% of normal events
  slowThresholdMs: 500,   // always keep events > 500ms
});

// Errors are ALWAYS kept — no config needed
log.event("http_request")
  .request(req)
  .error(new Error("DB timeout"))  // forces keep
  .end();                          // always emitted

// Slow events are kept automatically
log.event("http_request")
  .request(req)
  .end(); // kept if duration > slowThresholdMs

// Force-keep for VIP traffic
const ev = log.event("http_request");
ev.request(req);
if (user.tier === "enterprise") ev.keep();
ev.end(); // always emitted

// Sampled events include sample_rate in metadata
// so you can extrapolate: 5 events at 5% = ~100 actual`,
		},
		{
			lang: "typescript",
			code: `// instrumentation.ts — captures console + errors
import { createLogger } from "relog.dev/next";

const relog = createLogger({
  url: "http://localhost:3485",
  service: "my-nextjs-app",
});

export async function register() {
  await relog.register();
}

// Automatic error tracking for all routes
export const onRequestError = relog.onRequestError;

// app/api/relog/route.ts — proxy for browser logs
import { createBrowserProxy } from "relog.dev/next";

export const POST = createBrowserProxy({
  url: process.env.RELOG_URL,
  auth: process.env.RELOG_AUTH,
  service: "my-nextjs-app",
});

// proxy.ts — logs every request with trace IDs
import { relogProxy } from "relog.dev/next";

export const proxy = relogProxy();`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/browser";

// Use your ingest key directly — it can only write logs
const log = createLogger({
  url: "https://logs.example.com",
  auth: "ik_prod_abc123",  // ingest key (write-only)
  service: "web-app",
  captureConsole: true,     // forward console.log/warn/error
  captureErrors: true,      // catch uncaught exceptions
});

log.info("page loaded", {
  route: location.pathname,
  referrer: document.referrer,
});

// Or proxy through your backend to keep keys server-side
const proxied = createLogger({
  endpoint: "/api/relog",   // your server-side proxy route
  service: "web-app",
});`,
		},
		{
			lang: "bash",
			code: `# Start server with three auth tiers
bunx relog.dev start \
  --ingest-key ik_prod_abc123 \
  --read-key rk_prod_xyz789 \
  --admin-key ak_prod_secret456

# Ingest: write-only access for your applications
curl -X POST http://localhost:3485/ingest \
  -H "Authorization: Bearer ik_prod_abc123" \
  -H "Content-Type: application/json" \
  -d '[{"level":"info","message":"deployed","service":"api"}]'

# Read: query, search, stream — for dashboards and agents
curl http://localhost:3485/logs/search?q=deployed \
  -H "Authorization: Bearer rk_prod_xyz789"

# Admin: full access including prune, export, config
curl -X POST http://localhost:3485/logs/prune?keep_days=30 \
  -H "Authorization: Bearer ak_prod_secret456"`,
		},
		{
			lang: "jsonc",
			code: `// Add to ~/.claude/settings.json (Claude Code)
// or configure in your MCP client of choice
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
}

// Available tools for AI agents:
//   search_logs  — full-text search with filters
//   query_logs   — run arbitrary SQL SELECT
//   get_stats    — log volume by level, service
//   tail_logs    — most recent entries
//   get_context  — surrounding logs by trace_id`,
		},
		{
			lang: "bash",
			code: `# Archive logs older than 7 days to S3 as Parquet
bunx relog.dev archive --keep-days 7

# Start server with S3 for unified hot + cold queries
bunx relog.dev start \
  --s3-endpoint https://s3.amazonaws.com \
  --s3-bucket my-logs \
  --s3-access-key AKIA... \
  --s3-secret-key ...

# DuckDB merges SQLite (hot) + S3 Parquet (cold)
# — queries and search work across both storages

# Works with any S3-compatible storage:
#   AWS S3, Cloudflare R2, MinIO, Backblaze B2`,
		},
		{
			lang: "bash",
			code: `# Stream logs in real-time with filters
bunx relog.dev tail --level error --service api

# Full-text search with time ranges
bunx relog.dev search --grep "payment failed" --from 1h

# Run SQL directly against your logs
bunx relog.dev query --sql \
  "SELECT service, level, COUNT(*) as n
   FROM logs
   WHERE timestamp > datetime('now', '-1 hour')
   GROUP BY service, level
   ORDER BY n DESC"

# Export for external analysis
bunx relog.dev export --format csv --from 7d

# View log volume stats
bunx relog.dev stats --from 24h`,
		},
	];

	return (
		<section className="mb-14 sm:mb-18">
			<div className="flex items-center gap-1 mb-3 overflow-x-auto tabs-scroll pb-1 -mx-5 px-5 sm:mx-0 sm:px-0">
				{tabs.map((t, i) => (
					<button
						key={t.label}
						onClick={() => setTab(i)}
						className={`inline-flex items-center gap-2 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
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
			<div className="mb-3">
				<p className="text-sm font-medium text-fg">{tabs[tab]!.title}</p>
				<p className="text-[13px] text-muted leading-relaxed mt-1">{tabs[tab]!.desc}</p>
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
					className="[&_pre]:p-4 [&_pre]:sm:p-5 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:sm:text-[13px] [&_pre]:leading-[1.7] [&_pre]:!bg-bg-code [&_code]:font-mono"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			) : (
				<pre className="p-4 sm:p-5 overflow-x-auto bg-bg-code text-[12px] sm:text-[13px] leading-[1.7]">
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
			q: "What are wide events?",
			a: "Instead of scattering log lines through a request, build one event with all context and emit it at the end. Use .request(req) and .response(res) to auto-extract HTTP context. You get a single record with every key-value pair plus automatic duration tracking and level escalation.",
		},
		{
			q: "How does tail sampling work?",
			a: "Set a sampleRate (0–1) on the logger. The decision happens after the event completes, so errors, slow requests, and .keep()-marked events are always kept. Only normal, fast events are sampled. Sampled events include the sample_rate in metadata so you can extrapolate totals in queries.",
		},
		{
			q: "Does it support authentication?",
			a: "Three hierarchical roles: ingest, read, admin. Bearer token auth on all endpoints.",
		},
	];

	return (
		<section className="mb-14 sm:mb-18">
			<div className="grid sm:grid-cols-2 gap-x-16 gap-y-4">
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
		<footer className="border-t border-border pt-6">
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
			<p className="text-muted/30 text-xs mt-4 pb-4">&copy; {new Date().getFullYear()} relog.dev</p>
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
