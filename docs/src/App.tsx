import { useEffect, useRef, useState } from "react";
import { motion, useInView, AnimatePresence } from "motion/react";
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["github-dark-default"],
			langs: ["typescript", "bash", "json", "jsonc", "sql", "python"],
		});
	}
	return highlighterPromise;
}

// ─── Reveal ──────────────────────────────────────────────────────────
function Reveal({
	children,
	className = "",
	delay = 0,
}: {
	children: React.ReactNode;
	className?: string;
	delay?: number;
}) {
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-60px" });
	return (
		<motion.div
			ref={ref}
			initial={{ opacity: 0, y: 20 }}
			animate={inView ? { opacity: 1, y: 0 } : {}}
			transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
			className={className}
		>
			{children}
		</motion.div>
	);
}

// ─── Streamlined app components ──────────────────────────────────────
// These mirror the actual relog app's visual style (log-row.tsx, level-badge.tsx)

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_BORDERS: Record<string, string> = {
	trace: "border-l-zinc-400/40",
	debug: "border-l-blue-400/40",
	info: "border-l-emerald-400/60",
	warn: "border-l-amber-400/70",
	error: "border-l-red-400/80",
	fatal: "border-l-fuchsia-400/80",
};

const LEVEL_TEXT: Record<string, string> = {
	trace: "text-zinc-500",
	debug: "text-blue-400",
	info: "text-emerald-400",
	warn: "text-amber-400",
	error: "text-red-400",
	fatal: "text-fuchsia-400",
};

interface MockLog {
	timestamp: string;
	level: LogLevel;
	service: string;
	message: string;
	trace_id?: string;
	meta?: Record<string, unknown>;
}

function LogRow({
	log,
	animate,
	selected,
	onClick,
}: {
	log: MockLog;
	animate?: boolean;
	selected?: boolean;
	onClick?: () => void;
}) {
	const inner = (
		<div
			onClick={onClick}
			className={`flex w-full items-center border-l-2 text-left text-xs transition-colors cursor-pointer ${selected ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"} ${LEVEL_BORDERS[log.level] ?? "border-l-transparent"}`}
		>
			<span className="shrink-0 px-3 py-[5px] text-muted/50 tabular-nums w-[90px] font-mono text-[11px]">
				{log.timestamp}
			</span>
			<span
				className={`shrink-0 w-[48px] py-[5px] text-[10px] font-semibold uppercase tracking-wider ${LEVEL_TEXT[log.level] ?? "text-muted"}`}
			>
				{log.level}
			</span>
			<span className="shrink-0 w-[80px] py-[5px] truncate text-muted/60 font-mono text-[11px]">
				{log.service}
			</span>
			<span className="min-w-0 flex-1 py-[5px] pr-3 truncate font-mono text-[12px] text-dim">
				{log.message}
			</span>
		</div>
	);

	if (animate) {
		return (
			<motion.div
				initial={{ opacity: 0, x: -8 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ duration: 0.3, ease: "easeOut" }}
			>
				{inner}
			</motion.div>
		);
	}
	return inner;
}

function LogDetail({ log }: { log: MockLog }) {
	return (
		<motion.div
			initial={{ height: 0, opacity: 0 }}
			animate={{ height: "auto", opacity: 1 }}
			exit={{ height: 0, opacity: 0 }}
			transition={{ duration: 0.2 }}
			className="overflow-hidden"
		>
			<div className="mx-2 mb-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] font-mono">
				<div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
					<span className="text-muted/50">timestamp</span>
					<span className="text-dim">{log.timestamp}</span>
					<span className="text-muted/50">level</span>
					<span className={LEVEL_TEXT[log.level] ?? "text-muted"}>{log.level}</span>
					<span className="text-muted/50">service</span>
					<span className="text-dim">{log.service}</span>
					<span className="text-muted/50">message</span>
					<span className="text-dim">{log.message}</span>
					{log.trace_id && (
						<>
							<span className="text-muted/50">trace_id</span>
							<span className="text-cyan">{log.trace_id}</span>
						</>
					)}
					{log.meta &&
						Object.entries(log.meta).map(([k, v]) => (
							<>
								<span key={`k-${k}`} className="text-muted/50">
									{k}
								</span>
								<span key={`v-${k}`} className="text-dim">
									{String(v)}
								</span>
							</>
						))}
				</div>
			</div>
		</motion.div>
	);
}

const LEVEL_BAR_COLORS: Record<string, string> = {
	fatal: "#e879a0",
	error: "#f87171",
	warn: "#fbbf24",
	info: "#34d399",
	debug: "#60a5fa",
	trace: "#71717a",
};

function MiniChart({ logs }: { logs: MockLog[] }) {
	const bucketCount = 20;
	const buckets: Record<string, number>[] = Array.from({ length: bucketCount }, () => ({
		info: 0,
		warn: 0,
		error: 0,
		debug: 0,
		trace: 0,
		fatal: 0,
	}));
	logs.forEach((log, i) => {
		const bi = Math.min(Math.floor((i / MOCK_LOGS.length) * bucketCount), bucketCount - 1);
		buckets[bi][log.level] = (buckets[bi][log.level] ?? 0) + 1;
	});

	const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
	const maxTotal = Math.max(...buckets.map((b) => levels.reduce((a, l) => a + (b[l] ?? 0), 0)), 1);
	const gap = 2;

	return (
		<div className="flex items-end gap-[2px] h-[48px] px-3 py-2">
			{buckets.map((bucket, bi) => {
				const total = levels.reduce((a, l) => a + (bucket[l] ?? 0), 0);
				const heightPct = total > 0 ? (total / maxTotal) * 100 : 0;
				return (
					<motion.div
						key={bi}
						className="flex-1 flex flex-col justify-end rounded-[2px] overflow-hidden"
						style={{
							height: `${Math.max(heightPct, heightPct > 0 ? 12 : 0)}%`,
							transformOrigin: "bottom",
						}}
						initial={{ scaleY: 0 }}
						animate={{ scaleY: 1 }}
						transition={{ delay: 0.05 + bi * 0.02, duration: 0.25, ease: "easeOut" }}
					>
						{levels.map((level) => {
							const count = bucket[level] ?? 0;
							if (count === 0) return null;
							const pct = (count / total) * 100;
							return (
								<div
									key={level}
									style={{
										height: `${pct}%`,
										backgroundColor: LEVEL_BAR_COLORS[level],
										minHeight: 2,
										marginTop: gap > 0 ? 0 : undefined,
									}}
								/>
							);
						})}
					</motion.div>
				);
			})}
		</div>
	);
}

// ─── App ─────────────────────────────────────────────────────────────
function App() {
	return (
		<div className="min-h-screen bg-bg">
			<div className="fixed inset-0 z-0 pointer-events-none">
				<div className="absolute -top-[200px] left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-accent/[0.03] rounded-full blur-[100px]" />
			</div>
			<Header />
			<main className="relative z-10">
				{/* 1. Hook: problem + promise */}
				<Hero />
				{/* 2. Show don't tell: immediate proof it works */}
				<LivePreview />
				{/* 3. Friction removal: ready to start? Here's how */}
				<Examples />
				{/* 4. Unique differentiators: why relog, not alternatives */}
				<ValueProps />
				{/* 5. Reduce complexity anxiety: "it's simple" */}
				<Architecture />
				{/* 5b. External sources — pull logs from CI/deploy/infra */}
				<ExternalSources />
				{/* 6. Product polish: see the real app */}
				<AppScreenshots />
				{/* 7. Reassurance checklist: yes, it does that too */}
				<Checklist />
				{/* 8. Overcome final objections */}
				<FAQ />
				{/* 9. Final push */}
				<ClosingCTA />
				<Footer />
			</main>
		</div>
	);
}

// ─── Header ──────────────────────────────────────────────────────────
function Header() {
	return (
		<motion.header
			initial={{ opacity: 0, y: -16 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5 }}
			className="fixed top-0 left-0 right-0 z-50 bg-bg/70 backdrop-blur-2xl border-b border-white/[0.06]"
		>
			<div className="max-w-5xl mx-auto px-5 sm:px-8 h-12 flex items-center justify-between">
				<a href="/" className="text-fg font-semibold tracking-tight text-[14px]">
					relog.dev
				</a>
				<nav className="flex items-center gap-1">
					<a
						href="https://github.com/TimMikeladze/relog"
						className="text-muted hover:text-fg transition-colors flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-white/[0.04] text-[12px]"
					>
						<GitHubIcon />
						GitHub
					</a>
					<a
						href="https://app.relog.dev"
						className="text-bg bg-fg rounded-md px-3 py-1 text-[12px] font-medium hover:bg-fg/85 transition-colors"
					>
						Open App
					</a>
				</nav>
			</div>
		</motion.header>
	);
}

// ─── Hero ────────────────────────────────────────────────────────────
function Hero() {
	return (
		<section className="pt-24 sm:pt-28 pb-6 max-w-5xl mx-auto px-5 sm:px-8">
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 0.15 }}
				className="mb-4"
			>
				<span className="inline-flex items-center gap-1.5 text-[11px] tracking-wide text-muted border border-white/[0.06] rounded-full px-2.5 py-0.5">
					<span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
					Open Source &middot; MIT
				</span>
			</motion.div>

			<motion.h1
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
				className="text-[2.25rem] sm:text-[3rem] lg:text-[3.5rem] font-bold tracking-[-0.04em] leading-[1.08] mb-3"
			>
				Structured logging
				<br />
				<span className="bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400 bg-clip-text text-transparent">
					for the agentic era.
				</span>
			</motion.h1>

			<motion.p
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.6, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
				className="text-dim text-[15px] leading-[1.7] mb-6 max-w-lg"
			>
				Ship structured logs from TypeScript, Python, or the browser. Query with SQL. Stream in
				real-time. Give your AI agents full access via MCP.{" "}
				<span className="text-muted">Self-hosted, free forever, MIT licensed.</span>
			</motion.p>

			<motion.div
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.6, delay: 0.5 }}
			>
				<div className="inline-flex bg-bg-code border border-white/[0.06] rounded-lg px-4 py-2.5 font-mono text-[13px] items-center gap-2.5">
					<span className="text-muted select-none">$</span>
					<span className="text-fg">bunx relog.dev start</span>
					<CopyButton text="bunx relog.dev start" />
				</div>
			</motion.div>
		</section>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			onClick={() => {
				navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
			className="text-muted hover:text-fg transition-colors ml-1 cursor-pointer"
		>
			{copied ? (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			) : (
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<rect x="9" y="9" width="13" height="13" rx="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</svg>
			)}
		</button>
	);
}

// ─── Live app preview (using streamlined app components) ─────────────
const MOCK_LOGS: MockLog[] = [
	{
		timestamp: "14:22:31",
		level: "info",
		service: "api",
		message: "GET /health 200 — 1ms",
		meta: { method: "GET", path: "/health", status: 200, duration_ms: 1 },
	},
	{
		timestamp: "14:22:31",
		level: "info",
		service: "api",
		message: "POST /api/events 201 — 9ms batch=4",
		meta: { method: "POST", path: "/api/events", batch_size: 4, duration_ms: 9 },
	},
	{
		timestamp: "14:22:32",
		level: "debug",
		service: "cache",
		message: "cache.hit key=config:global ttl=600s",
		meta: { key: "config:global", ttl: 600, action: "hit" },
	},
	{
		timestamp: "14:22:33",
		level: "info",
		service: "worker",
		message: "job.complete email_digest count=142",
		meta: { job: "email_digest", count: 142, duration_ms: 890 },
	},
	{
		timestamp: "14:22:33",
		level: "info",
		service: "api",
		message: "GET /api/teams 200 — 14ms",
		meta: { method: "GET", path: "/api/teams", status: 200, duration_ms: 14 },
	},
	{
		timestamp: "14:22:34",
		level: "info",
		service: "api",
		message: "POST /api/events 201 — 12ms batch=8",
		meta: { method: "POST", path: "/api/events", batch_size: 8, duration_ms: 12 },
	},
	{
		timestamp: "14:22:35",
		level: "debug",
		service: "cache",
		message: "cache.miss key=tenant:acme:limits ttl=60s",
		meta: { key: "tenant:acme:limits", ttl: 60, action: "miss" },
	},
	{
		timestamp: "14:22:36",
		level: "info",
		service: "api",
		message: "GET /api/users/u_42 200 — 8ms",
		trace_id: "tr_a1b2c3d4",
		meta: { method: "GET", path: "/api/users/u_42", status: 200, duration_ms: 8 },
	},
	{
		timestamp: "14:22:37",
		level: "warn",
		service: "db",
		message: "connection_pool near capacity used=48/50",
		meta: { used: 48, max: 50, waiting: 3 },
	},
	{
		timestamp: "14:22:37",
		level: "info",
		service: "api",
		message: "POST /webhooks/stripe 200 — 34ms",
		trace_id: "tr_e5f6a7b8",
		meta: { method: "POST", path: "/webhooks/stripe", event: "invoice.paid", duration_ms: 34 },
	},
	{
		timestamp: "14:22:38",
		level: "info",
		service: "api",
		message: "GET /api/projects 200 — 11ms",
		meta: { method: "GET", path: "/api/projects", status: 200, duration_ms: 11 },
	},
	{
		timestamp: "14:22:39",
		level: "debug",
		service: "cache",
		message: "cache.miss key=user:u_293:prefs ttl=300s",
		meta: { key: "user:u_293:prefs", ttl: 300, action: "miss" },
	},
	{
		timestamp: "14:22:40",
		level: "info",
		service: "auth",
		message: "token.refresh user=u_88 method=jwt",
		trace_id: "tr_c9d0e1f2",
		meta: { user_id: "u_88", method: "jwt", expires_in: 3600 },
	},
	{
		timestamp: "14:22:41",
		level: "info",
		service: "api",
		message: "GET /api/logs 200 — 18ms rows=50",
		meta: { method: "GET", path: "/api/logs", rows: 50, duration_ms: 18 },
	},
	{
		timestamp: "14:22:41",
		level: "info",
		service: "worker",
		message: "job.process webhook_delivery queued=7",
		meta: { job: "webhook_delivery", queued: 7 },
	},
	{
		timestamp: "14:22:42",
		level: "error",
		service: "payments",
		message: "stripe.charge.failed card_declined user=u_293",
		trace_id: "tr_7c3b5e8f",
		meta: { error: "card_declined", user_id: "u_293", amount: 4999, currency: "usd" },
	},
	{
		timestamp: "14:22:43",
		level: "info",
		service: "api",
		message: "POST /users 201 — 42ms",
		trace_id: "tr_8f2a1b3c",
		meta: { method: "POST", path: "/users", status: 201, duration_ms: 42 },
	},
	{
		timestamp: "14:22:43",
		level: "info",
		service: "api",
		message: "GET /health 200 — 1ms",
		meta: { method: "GET", path: "/health", status: 200, duration_ms: 1 },
	},
	{
		timestamp: "14:22:44",
		level: "info",
		service: "worker",
		message: "job.process email_verification queued=3",
		meta: { job: "email_verification", queued: 3 },
	},
	{
		timestamp: "14:22:45",
		level: "warn",
		service: "api",
		message: "rate_limit_near tenant=acme count=980/1000",
		trace_id: "tr_9d4e2f1a",
		meta: { tenant: "acme", count: 980, limit: 1000 },
	},
	{
		timestamp: "14:22:46",
		level: "info",
		service: "api",
		message: "PATCH /api/teams/t_5 200 — 22ms",
		trace_id: "tr_3a4b5c6d",
		meta: { method: "PATCH", path: "/api/teams/t_5", status: 200, duration_ms: 22 },
	},
	{
		timestamp: "14:22:46",
		level: "debug",
		service: "cache",
		message: "cache.evict key=report:daily:2024-03-08",
		meta: { key: "report:daily:2024-03-08", reason: "ttl_expired" },
	},
	{
		timestamp: "14:22:47",
		level: "info",
		service: "api",
		message: "POST /ingest 200 — 3ms batch=24",
		meta: { method: "POST", path: "/ingest", batch_size: 24, duration_ms: 3 },
	},
	{
		timestamp: "14:22:47",
		level: "info",
		service: "api",
		message: "GET /api/settings 200 — 5ms",
		meta: { method: "GET", path: "/api/settings", status: 200, duration_ms: 5 },
	},
	{
		timestamp: "14:22:48",
		level: "warn",
		service: "db",
		message: "slow_query duration=1204ms table=events",
		trace_id: "tr_2a8f4c1e",
		meta: { duration_ms: 1204, table: "events", query: "SELECT * FROM events WHERE..." },
	},
	{
		timestamp: "14:22:49",
		level: "info",
		service: "auth",
		message: "session.created user=u_42 method=oauth",
		trace_id: "tr_5b7d9e3a",
		meta: { user_id: "u_42", method: "oauth", provider: "github" },
	},
	{
		timestamp: "14:22:49",
		level: "info",
		service: "api",
		message: "GET /api/dashboard 200 — 89ms",
		meta: { method: "GET", path: "/api/dashboard", status: 200, duration_ms: 89 },
	},
	{
		timestamp: "14:22:50",
		level: "debug",
		service: "cache",
		message: "cache.set key=dashboard:u_42 ttl=30s",
		meta: { key: "dashboard:u_42", ttl: 30, size_bytes: 4200 },
	},
	{
		timestamp: "14:22:51",
		level: "info",
		service: "worker",
		message: "job.process invoice_generate queued=1",
		meta: { job: "invoice_generate", queued: 1, priority: "high" },
	},
	{
		timestamp: "14:22:51",
		level: "info",
		service: "api",
		message: "POST /api/events 201 — 6ms batch=12",
		meta: { method: "POST", path: "/api/events", batch_size: 12, duration_ms: 6 },
	},
	{
		timestamp: "14:22:52",
		level: "error",
		service: "api",
		message: "unhandled_rejection TypeError: Cannot read null",
		trace_id: "tr_1f6c8a2d",
		meta: { error_type: "TypeError", stack: "at Object.handler (/src/routes/users.ts:42:15)" },
	},
	{
		timestamp: "14:22:53",
		level: "info",
		service: "api",
		message: "DELETE /sessions/s_88 200 — 6ms",
		meta: { method: "DELETE", path: "/sessions/s_88", status: 200, duration_ms: 6 },
	},
	{
		timestamp: "14:22:53",
		level: "info",
		service: "api",
		message: "GET /api/logs/stream 200 — SSE",
		meta: { method: "GET", path: "/api/logs/stream", type: "sse", filters: "level=error" },
	},
	{
		timestamp: "14:22:54",
		level: "debug",
		service: "cache",
		message: "cache.set key=user:u_42:profile ttl=300s",
		meta: { key: "user:u_42:profile", ttl: 300, size_bytes: 1240 },
	},
	{
		timestamp: "14:22:55",
		level: "info",
		service: "api",
		message: "GET /api/search?q=payment 200 — 156ms",
		trace_id: "tr_d7e8f9a0",
		meta: { method: "GET", query: "payment", results: 23, duration_ms: 156 },
	},
	{
		timestamp: "14:22:55",
		level: "info",
		service: "api",
		message: "GET /health 200 — 1ms",
		meta: { method: "GET", path: "/health", status: 200, duration_ms: 1 },
	},
	{
		timestamp: "14:22:56",
		level: "info",
		service: "api",
		message: "POST /api/logs/export 200 — 2104ms",
		trace_id: "tr_b1c2d3e4",
		meta: { method: "POST", format: "csv", rows: 15420, duration_ms: 2104 },
	},
	{
		timestamp: "14:22:57",
		level: "warn",
		service: "api",
		message: "deprecated_endpoint GET /api/users/legacy use /api/v2/users",
		meta: {
			endpoint: "/api/users/legacy",
			replacement: "/api/v2/users",
			caller: "sdk-python/0.3.1",
		},
	},
	{
		timestamp: "14:22:57",
		level: "info",
		service: "api",
		message: "POST /ingest 200 — 2ms batch=6",
		meta: { method: "POST", path: "/ingest", batch_size: 6, duration_ms: 2 },
	},
	{
		timestamp: "14:22:58",
		level: "info",
		service: "cron",
		message: "archive.complete rows=8420 size=2.4MB",
		meta: { rows: 8420, size_mb: 2.4, format: "parquet", destination: "s3://logs/2024-03-08/" },
	},
	{
		timestamp: "14:22:59",
		level: "debug",
		service: "cache",
		message: "cache.hit key=user:u_88:session ttl=3600s",
		meta: { key: "user:u_88:session", ttl: 3600, action: "hit" },
	},
	{
		timestamp: "14:22:59",
		level: "info",
		service: "api",
		message: "GET /api/traces/tr_8f2a 200 — 24ms",
		trace_id: "tr_8f2a1b3c",
		meta: { method: "GET", path: "/api/traces/tr_8f2a", spans: 4, duration_ms: 24 },
	},
	{
		timestamp: "14:23:00",
		level: "info",
		service: "api",
		message: "POST /api/events 201 — 8ms batch=16",
		meta: { method: "POST", path: "/api/events", batch_size: 16, duration_ms: 8 },
	},
	{
		timestamp: "14:23:01",
		level: "error",
		service: "worker",
		message: "job.failed send_notification timeout after 30s",
		trace_id: "tr_f4e3d2c1",
		meta: { job: "send_notification", error: "timeout", retry: 2 },
	},
	{
		timestamp: "14:23:01",
		level: "info",
		service: "api",
		message: "GET /api/stats 200 — 45ms",
		meta: { method: "GET", path: "/api/stats", duration_ms: 45 },
	},
	{
		timestamp: "14:23:02",
		level: "info",
		service: "api",
		message: "GET /health 200 — 1ms",
		meta: { method: "GET", path: "/health", status: 200, duration_ms: 1 },
	},
	{
		timestamp: "14:23:03",
		level: "info",
		service: "auth",
		message: "login.success user=u_155 method=password",
		trace_id: "tr_a9b8c7d6",
		meta: { user_id: "u_155", method: "password", ip: "203.0.113.42" },
	},
	{
		timestamp: "14:23:03",
		level: "warn",
		service: "api",
		message: "response_slow GET /api/reports duration=890ms",
		trace_id: "tr_e5d4c3b2",
		meta: { method: "GET", path: "/api/reports", duration_ms: 890, threshold_ms: 500 },
	},
	{
		timestamp: "14:23:04",
		level: "info",
		service: "api",
		message: "POST /ingest 200 — 4ms batch=31",
		meta: { method: "POST", path: "/ingest", batch_size: 31, duration_ms: 4 },
	},
	{
		timestamp: "14:23:04",
		level: "debug",
		service: "cache",
		message: "cache.miss key=report:weekly:2024-w10",
		meta: { key: "report:weekly:2024-w10", action: "miss" },
	},
];

function LivePreview() {
	const [visible, setVisible] = useState<MockLog[]>([]);
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-40px" });

	useEffect(() => {
		if (!inView) return;
		let count = 0;
		const interval = setInterval(() => {
			count++;
			if (count > MOCK_LOGS.length) {
				clearInterval(interval);
				return;
			}
			setVisible(MOCK_LOGS.slice(0, count));
		}, 25);
		return () => clearInterval(interval);
	}, [inView]);

	const toggleExpand = (i: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(i)) next.delete(i);
			else next.add(i);
			return next;
		});
	};

	return (
		<section ref={ref} className="max-w-5xl mx-auto px-5 sm:px-8 pb-10">
			<Reveal>
				<div className="rounded-lg border border-white/[0.06] overflow-hidden bg-bg-card/40">
					{/* Mini histogram chart */}
					<div className="border-b border-white/[0.06]">
						<MiniChart logs={visible} />
					</div>
					{/* Column headers — matches app's log-table.tsx */}
					<div className="flex items-center border-b border-white/[0.06] text-[10px] font-medium uppercase tracking-wider text-muted/40 border-l-2 border-l-transparent">
						<span className="shrink-0 px-3 py-1.5 w-[90px]">Time</span>
						<span className="shrink-0 w-[48px] py-1.5">Level</span>
						<span className="shrink-0 w-[80px] py-1.5">Service</span>
						<span className="min-w-0 flex-1 py-1.5 pr-3">Message</span>
					</div>
					{/* Log rows */}
					<div className="max-h-[240px] overflow-y-auto relative">
						{visible.map((log, i) => (
							<div key={i}>
								<LogRow
									log={log}
									animate
									selected={expandedIds.has(i)}
									onClick={() => toggleExpand(i)}
								/>
								<AnimatePresence>{expandedIds.has(i) && <LogDetail log={log} />}</AnimatePresence>
							</div>
						))}
					</div>
				</div>
			</Reveal>
		</section>
	);
}

// ─── App screenshots ─────────────────────────────────────────────────
function AppScreenshots() {
	const [active, setActive] = useState(0);

	const views = [
		{
			label: "Explore",
			desc: "Browse & filter logs in real-time",
			img: "/screenshots/explore.png",
		},
		{ label: "Traces", desc: "Distributed trace visualization", img: "/screenshots/traces.png" },
		{ label: "Query", desc: "SQL query interface", img: "/screenshots/query.png" },
		{ label: "Dashboard", desc: "Volume & level analytics", img: "/screenshots/dashboard.png" },
	];

	return (
		<section className="max-w-5xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-4">See it in action</h2>
			</Reveal>

			<Reveal delay={0.1}>
				{/* View tabs */}
				<div className="flex items-center gap-1 mb-3">
					{views.map((v, i) => (
						<button
							key={v.label}
							onClick={() => setActive(i)}
							className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-all cursor-pointer ${active === i ? "text-fg bg-white/[0.08]" : "text-muted hover:text-dim hover:bg-white/[0.03]"}`}
						>
							{v.label}
						</button>
					))}
				</div>

				{/* Main screenshot */}
				<AnimatePresence mode="wait">
					<motion.div
						key={active}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="rounded-lg border border-white/[0.06] overflow-hidden"
					>
						{/* Browser chrome */}
						<div className="flex items-center gap-1.5 px-3 h-8 bg-white/[0.02] border-b border-white/[0.06]">
							<span className="w-2 h-2 rounded-full bg-white/[0.08]" />
							<span className="w-2 h-2 rounded-full bg-white/[0.08]" />
							<span className="w-2 h-2 rounded-full bg-white/[0.08]" />
							<span className="ml-2 text-[10px] text-muted/40 bg-white/[0.03] rounded px-2 py-0.5 flex-1 max-w-40 border border-white/[0.04]">
								app.relog.dev
							</span>
						</div>

						{/* Screenshot placeholder — replace src with actual screenshots */}
						<div className="bg-bg-code aspect-[16/9] sm:aspect-[2/1] flex items-center justify-center relative">
							<img
								src={views[active]!.img}
								alt={`relog.dev ${views[active]!.label} view`}
								className="w-full h-full object-cover object-top"
								onError={(e) => {
									// Hide broken image, show placeholder
									(e.target as HTMLImageElement).style.display = "none";
									(e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
								}}
							/>
							{/* Fallback placeholder when image not found */}
							<div className="hidden absolute inset-0 flex flex-col items-center justify-center text-muted/30">
								<svg
									width="32"
									height="32"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="1"
									className="mb-2"
								>
									<rect x="2" y="3" width="20" height="14" rx="2" />
									<line x1="8" y1="21" x2="16" y2="21" />
									<line x1="12" y1="17" x2="12" y2="21" />
								</svg>
								<span className="text-[11px]">
									{views[active]!.label} — {views[active]!.desc}
								</span>
								<span className="text-[10px] mt-1">
									Place screenshot at /public{views[active]!.img}
								</span>
							</div>
						</div>
					</motion.div>
				</AnimatePresence>

				{/* Thumbnail strip */}
				<div className="grid grid-cols-4 gap-2 mt-2">
					{views.map((v, i) => (
						<button
							key={v.label}
							onClick={() => setActive(i)}
							className={`rounded-md border overflow-hidden cursor-pointer transition-all ${active === i ? "border-white/[0.15] ring-1 ring-accent/30" : "border-white/[0.04] opacity-60 hover:opacity-80"}`}
						>
							<div className="bg-bg-code aspect-[16/9] flex items-center justify-center relative">
								<img
									src={v.img}
									alt={`${v.label} thumbnail`}
									className="w-full h-full object-cover object-top"
									onError={(e) => {
										(e.target as HTMLImageElement).style.display = "none";
										(e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
									}}
								/>
								<div className="hidden absolute inset-0 flex items-center justify-center">
									<span className="text-[10px] text-muted/30">{v.label}</span>
								</div>
							</div>
						</button>
					))}
				</div>
			</Reveal>
		</section>
	);
}

// ─── Architecture flow diagram (horizontal on desktop, vertical on mobile) ──
function ArchNode({
	label,
	sub,
	color,
	delay,
	inView,
}: {
	label: string;
	sub?: string;
	color: string;
	delay: number;
	inView: boolean;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 6 }}
			animate={inView ? { opacity: 1, y: 0 } : {}}
			transition={{ delay, duration: 0.3 }}
			className="rounded-md border bg-white/[0.03] px-2.5 py-1.5 text-center"
			style={{ borderColor: `${color}40` }}
		>
			<div className="text-[11px] font-semibold text-fg leading-tight">{label}</div>
			{sub && <div className="text-[9px] text-muted/50 leading-tight">{sub}</div>}
		</motion.div>
	);
}

function ArchArrow({
	dashed,
	label,
	delay,
	inView,
}: {
	dashed?: boolean;
	label?: string;
	delay: number;
	inView: boolean;
}) {
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={inView ? { opacity: 1 } : {}}
			transition={{ delay, duration: 0.25 }}
			className="flex items-center justify-center arch-arrow"
		>
			<div
				className="arch-arrow-line"
				style={{
					borderColor: "rgba(255,255,255,0.12)",
					borderStyle: dashed ? "dashed" : "solid",
				}}
			/>
			{label && <span className="text-[8px] text-amber-400/50 italic shrink-0">{label}</span>}
			<svg
				className="arch-arrow-head text-white/15 shrink-0"
				width="6"
				height="5"
				viewBox="0 0 6 5"
			>
				<path d="M0 0 L3 5 L6 0" fill="none" stroke="currentColor" strokeWidth="1" />
			</svg>
		</motion.div>
	);
}

function ArchLabel({
	text,
	color,
	delay,
	inView,
}: {
	text: string;
	color: string;
	delay: number;
	inView: boolean;
}) {
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={inView ? { opacity: 0.4 } : {}}
			transition={{ delay, duration: 0.25 }}
			className="text-[8px] font-semibold uppercase tracking-[0.12em] arch-label"
			style={{ color }}
		>
			{text}
		</motion.div>
	);
}

function ArchitectureDiagram({ inView }: { inView: boolean }) {
	return (
		<div className="arch-flow">
			{/* Column/Row 1: Ingest */}
			<div className="arch-stage">
				<ArchLabel text="Ingest" color="#6ee7b7" delay={0.05} inView={inView} />
				<div className="flex gap-1.5 arch-nodes">
					<ArchNode label="TypeScript" sub="SDK" color="#6ee7b7" delay={0.1} inView={inView} />
					<ArchNode label="Python" sub="SDK" color="#6ee7b7" delay={0.13} inView={inView} />
					<ArchNode label="Browser" sub="SDK" color="#6ee7b7" delay={0.16} inView={inView} />
					<ArchNode
						label="Sources"
						sub="GitHub Actions, etc."
						color="#6ee7b7"
						delay={0.19}
						inView={inView}
					/>
				</div>
			</div>

			<ArchArrow delay={0.2} inView={inView} />

			{/* Column/Row 2: Server */}
			<div className="arch-stage">
				<ArchNode label="Bun + Hono" sub="server" color="#818cf8" delay={0.25} inView={inView} />
			</div>

			<ArchArrow delay={0.3} inView={inView} />

			{/* Column/Row 3: Storage */}
			<div className="arch-stage">
				<ArchLabel text="Storage" color="#fcd34d" delay={0.33} inView={inView} />
				<div className="flex items-center gap-1.5 arch-nodes">
					<ArchNode label="SQLite" sub="WAL mode" color="#fcd34d" delay={0.35} inView={inView} />
					<ArchArrow dashed label="archive" delay={0.38} inView={inView} />
					<ArchNode label="S3 / R2" sub="Parquet" color="#fcd34d" delay={0.4} inView={inView} />
				</div>
			</div>

			<ArchArrow delay={0.45} inView={inView} />

			{/* Column/Row 4: Query */}
			<div className="arch-stage">
				<ArchNode label="DuckDB" sub="query engine" color="#67e8f9" delay={0.5} inView={inView} />
			</div>

			<ArchArrow delay={0.55} inView={inView} />

			{/* Column/Row 5: Consume */}
			<div className="arch-stage">
				<ArchLabel text="Consume" color="#a1a1aa" delay={0.58} inView={inView} />
				<div className="flex gap-1.5 arch-nodes flex-wrap justify-center">
					<ArchNode label="Web UI" color="#a1a1aa" delay={0.6} inView={inView} />
					<ArchNode label="CLI" color="#a1a1aa" delay={0.63} inView={inView} />
					<ArchNode label="MCP" sub="AI agents" color="#a1a1aa" delay={0.66} inView={inView} />
					<ArchNode label="SQL" color="#a1a1aa" delay={0.69} inView={inView} />
				</div>
			</div>
		</div>
	);
}

// ─── Architecture — reduce complexity anxiety ───────────────────────
function Architecture() {
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-60px" });

	return (
		<section ref={ref} className="max-w-5xl mx-auto px-5 sm:px-8 py-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-2">How it works</h2>
				<p className="text-[13px] text-muted mb-6 max-w-2xl">
					SDKs batch and ship logs to a Bun server over HTTP. The server writes to SQLite in WAL
					mode for high-throughput concurrent reads and writes. When logs age out, an archive
					command converts them to Parquet files on S3, R2, or MinIO. DuckDB sits on top as the
					query engine — it reads both hot data in SQLite and cold data in object storage, so every
					query spans your full history without loading everything into memory. The Web UI, CLI, MCP
					server, and raw SQL all talk to DuckDB.
				</p>
			</Reveal>

			<Reveal delay={0.1}>
				<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5">
					<ArchitectureDiagram inView={inView} />
				</div>
			</Reveal>
		</section>
	);
}

// ─── Value props — unique differentiators ────────────────────────────
function ValueProps() {
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-60px" });

	return (
		<section ref={ref} className="max-w-5xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-2">Why relog?</h2>
				<p className="text-[13px] text-muted mb-6">
					Not just another logger. Wide events, tail sampling, and AI agents — from day one.
				</p>
			</Reveal>

			<div className="grid sm:grid-cols-3 gap-3">
				{/* Wide events */}
				<Reveal delay={0.1}>
					<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 h-full">
						<h3 className="text-[13px] font-medium text-fg mb-3">Wide events</h3>
						<div className="space-y-2">
							{[
								'ev = log.event("http_request")',
								"ev.request(req)",
								'ev.set("user_id", user.id)',
								"ev.response(res)",
								"ev.end()",
							].map((step, i) => (
								<motion.div
									key={i}
									initial={{ opacity: 0, x: -8 }}
									animate={inView ? { opacity: 1, x: 0 } : {}}
									transition={{ delay: 0.3 + i * 0.05, duration: 0.3 }}
									className="flex items-center gap-2"
								>
									<span className="w-1 h-1 rounded-full bg-cyan shrink-0" />
									<code className="text-[11px] font-mono text-dim">{step}</code>
								</motion.div>
							))}
						</div>
						<div className="mt-3 pt-3 border-t border-white/[0.04] text-[11px] text-muted">
							One structured record per request instead of scattered log lines.
						</div>
					</div>
				</Reveal>

				{/* Tail sampling */}
				<Reveal delay={0.15}>
					<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 h-full">
						<h3 className="text-[13px] font-medium text-fg mb-3">Tail sampling</h3>
						<div className="space-y-1.5">
							{[
								{ label: "Error event", badge: "KEEP", kept: true, color: "text-red-400" },
								{
									label: "Slow request (1.2s)",
									badge: "KEEP",
									kept: true,
									color: "text-amber-400",
								},
								{
									label: "VIP user (.keep())",
									badge: "KEEP",
									kept: true,
									color: "text-emerald-400",
								},
								{ label: "Normal GET /health", badge: "5%", kept: false, color: "text-muted" },
								{ label: "Normal POST /users", badge: "5%", kept: false, color: "text-muted" },
							].map((s, i) => (
								<motion.div
									key={i}
									initial={{ opacity: 0, x: -8 }}
									animate={inView ? { opacity: 1, x: 0 } : {}}
									transition={{ delay: 0.4 + i * 0.05, duration: 0.3 }}
									className={`flex items-center gap-2 text-[12px] ${s.kept ? "" : "opacity-50"}`}
								>
									<span className={`${s.color} font-mono flex-1`}>{s.label}</span>
									<span
										className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.kept ? "bg-emerald-400/15 text-emerald-400" : "bg-white/[0.04] text-muted"}`}
									>
										{s.badge}
									</span>
								</motion.div>
							))}
						</div>
						<div className="mt-3 pt-3 border-t border-white/[0.04] text-[11px] text-muted">
							Decide after the event completes. Important events always kept.
						</div>
					</div>
				</Reveal>

				{/* MCP */}
				<Reveal delay={0.2}>
					<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 h-full">
						<h3 className="text-[13px] font-medium text-fg mb-3">MCP server</h3>
						<p className="text-[12px] text-muted mb-3">
							AI agents query your logs via tool use. Works with Claude Code, Cursor, and any MCP
							client.
						</p>
						<div className="space-y-1.5">
							{[
								{ tool: "search_logs", desc: "Full-text search" },
								{ tool: "query_logs", desc: "SQL SELECT" },
								{ tool: "get_stats", desc: "Volume stats" },
								{ tool: "tail_logs", desc: "Recent entries" },
								{ tool: "get_context", desc: "Trace context" },
							].map((t, i) => (
								<motion.div
									key={t.tool}
									initial={{ opacity: 0, x: -8 }}
									animate={inView ? { opacity: 1, x: 0 } : {}}
									transition={{ delay: 0.5 + i * 0.05, duration: 0.3 }}
									className="flex items-center gap-2"
								>
									<code className="text-[11px] font-mono text-accent">{t.tool}</code>
									<span className="text-[10px] text-muted">{t.desc}</span>
								</motion.div>
							))}
						</div>
					</div>
				</Reveal>
			</div>
		</section>
	);
}

// ─── External Sources — pull logs from CI/deploy/infra ─────────────────
function ExternalSources() {
	const ref = useRef(null);
	const inView = useInView(ref, { once: true, margin: "-60px" });

	const sources = [
		{ name: "GitHub Actions", desc: "CI/CD workflow runs, jobs, steps", color: "text-white" },
		{ name: "Vercel", desc: "Deploy logs, serverless functions", color: "text-muted" },
		{ name: "CloudWatch", desc: "AWS service logs", color: "text-muted" },
		{ name: "Docker", desc: "Container stdout/stderr", color: "text-muted" },
		{ name: "Custom", desc: "Any API via adapter interface", color: "text-muted" },
	];

	const mappings = [
		{ from: "Repository", to: "project", example: "myorg/api" },
		{ from: "Branch", to: "branch", example: "main" },
		{ from: "Run ID", to: "trace_id", example: "gha:7890123456" },
		{ from: "Job name", to: "service", example: "build" },
		{ from: "Commit SHA", to: "version", example: "a1b2c3d4" },
		{ from: "Step result", to: "level", example: "error if failed" },
	];

	return (
		<section ref={ref} className="max-w-5xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-2">External sources</h2>
				<p className="text-[13px] text-muted mb-6 max-w-2xl">
					Pull logs from GitHub Actions, Vercel, and other systems into relog automatically. One
					timeline for app logs, CI failures, and deploy events — no more switching between UIs to
					debug an incident.
				</p>
			</Reveal>

			<div className="grid sm:grid-cols-2 gap-3">
				{/* Left: why + sources list */}
				<Reveal delay={0.1}>
					<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 h-full">
						<h3 className="text-[13px] font-medium text-fg mb-3">Configure once, pull forever</h3>
						<p className="text-[11px] text-muted mb-3">
							Define sources in a YAML file. The server polls each on an interval, tracks its cursor
							in SQLite, and inserts logs directly — surviving restarts without re-fetching.
						</p>
						<div className="space-y-1.5">
							{sources.map((s, i) => (
								<motion.div
									key={s.name}
									initial={{ opacity: 0, x: -8 }}
									animate={inView ? { opacity: 1, x: 0 } : {}}
									transition={{ delay: 0.3 + i * 0.05, duration: 0.3 }}
									className="flex items-center gap-2"
								>
									<span
										className={`text-[11px] font-mono ${i === 0 ? "text-fg" : "text-muted/50"}`}
									>
										{s.name}
									</span>
									<span className="text-[10px] text-muted/40">{s.desc}</span>
								</motion.div>
							))}
						</div>
					</div>
				</Reveal>

				{/* Right: field mapping */}
				<Reveal delay={0.15}>
					<div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4 h-full">
						<h3 className="text-[13px] font-medium text-fg mb-3">GitHub Actions → relog fields</h3>
						<div className="space-y-1.5">
							{mappings.map((m, i) => (
								<motion.div
									key={m.from}
									initial={{ opacity: 0, x: -8 }}
									animate={inView ? { opacity: 1, x: 0 } : {}}
									transition={{ delay: 0.4 + i * 0.04, duration: 0.3 }}
									className="flex items-center gap-2 text-[11px]"
								>
									<span className="text-muted/50 w-[80px] shrink-0 font-mono">{m.from}</span>
									<span className="text-muted/30">→</span>
									<span className="text-accent font-mono">{m.to}</span>
									<span className="text-muted/30 ml-auto font-mono text-[10px]">{m.example}</span>
								</motion.div>
							))}
						</div>
						<div className="mt-3 pt-3 border-t border-white/[0.04] text-[11px] text-muted">
							Search CI failures with{" "}
							<code className="text-accent/70">relog search --level error --project myorg/api</code>
						</div>
					</div>
				</Reveal>
			</div>

			{/* Config example */}
			<Reveal delay={0.25}>
				<div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
					<div className="flex items-center gap-2 mb-2">
						<span className="text-[10px] text-muted/50 font-mono">sources.yaml</span>
					</div>
					<pre className="text-[11px] font-mono text-dim leading-relaxed">
						<span className="text-muted/40">sources:</span>
						{"\n"}
						<span className="text-muted/40">{"  "}- </span>
						<span className="text-accent/70">adapter</span>
						<span className="text-muted/40">: </span>
						<span className="text-fg/80">github-actions</span>
						{"\n"}
						<span className="text-muted/40">{"    "}</span>
						<span className="text-accent/70">repo</span>
						<span className="text-muted/40">: </span>
						<span className="text-fg/80">myorg/api</span>
						{"\n"}
						<span className="text-muted/40">{"    "}</span>
						<span className="text-accent/70">token</span>
						<span className="text-muted/40">: </span>
						<span className="text-amber-400/70">$GITHUB_TOKEN</span>
						{"\n"}
						<span className="text-muted/40">{"    "}</span>
						<span className="text-accent/70">every</span>
						<span className="text-muted/40">: </span>
						<span className="text-fg/80">60</span>
					</pre>
					<div className="mt-3 pt-3 border-t border-white/[0.04]">
						<code className="text-[11px] font-mono text-muted/60">
							GITHUB_TOKEN=ghp_... relog.dev start --sources sources.yaml
						</code>
					</div>
				</div>
			</Reveal>
		</section>
	);
}

// ─── Checklist — scannable feature list ───────────────────────────────
function Checklist() {
	const items = [
		"TypeScript SDK",
		"Python SDK",
		"Browser SDK",
		"Next.js integration",
		"Wide events",
		"Tail sampling",
		"SQLite + WAL mode",
		"S3 / R2 archival",
		"SQL queries via DuckDB",
		"Full-text search",
		"Real-time streaming",
		"Distributed tracing",
		"Web UI",
		"CLI",
		"MCP server",
		"Role-based auth",
		"Deployment context",
		"External sources",
		"Zero config",
	];

	return (
		<section className="max-w-5xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-4">Everything included</h2>
			</Reveal>
			<Reveal delay={0.1}>
				<div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2.5 rounded-lg border border-white/[0.06] bg-white/[0.015] p-5">
					{items.map((item, i) => (
						<motion.div
							key={item}
							initial={{ opacity: 0 }}
							whileInView={{ opacity: 1 }}
							viewport={{ once: true }}
							transition={{ delay: i * 0.02, duration: 0.3 }}
							className="flex items-center gap-2 text-[13px]"
						>
							<span className="text-emerald-400/60 text-[11px]">✓</span>
							<span className="text-dim">{item}</span>
						</motion.div>
					))}
				</div>
			</Reveal>
		</section>
	);
}

// ─── Closing CTA ──────────────────────────────────────────────────────
function ClosingCTA() {
	return (
		<section className="max-w-5xl mx-auto px-5 sm:px-8 py-16">
			<Reveal>
				<div className="text-center">
					<h2 className="text-xl sm:text-2xl font-bold tracking-tight mb-2">
						Ready to replace{" "}
						<code className="font-mono text-amber-400/80 text-[0.9em]">console.log</code>?
					</h2>
					<p className="text-[13px] text-muted mb-6">
						One command. Zero config. Your logs, your infrastructure.
					</p>
					<div className="inline-flex bg-bg-code border border-white/[0.06] rounded-lg px-4 py-2.5 font-mono text-[13px] items-center gap-2.5">
						<span className="text-muted select-none">$</span>
						<span className="text-fg">bunx relog.dev start</span>
						<CopyButton text="bunx relog.dev start" />
					</div>
					<div className="flex items-center justify-center gap-3 mt-5">
						<a
							href="https://github.com/TimMikeladze/relog"
							className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-fg transition-colors px-3 py-1.5 rounded-md border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"
						>
							<GitHubIcon />
							View on GitHub
						</a>
						<a
							href="https://app.relog.dev"
							className="inline-flex items-center gap-1.5 text-[12px] font-medium text-bg bg-fg hover:bg-fg/90 transition-colors px-3.5 py-1.5 rounded-md"
						>
							Open App
							<span className="text-[10px]">→</span>
						</a>
					</div>
				</div>
			</Reveal>
		</section>
	);
}

// ─── Examples ────────────────────────────────────────────────────────
function Examples() {
	const [tab, setTab] = useState(0);

	const tabs = [
		{
			label: "SDK",
			title: "Client SDK",
			desc: "Structured logs with automatic batching, retries, and child loggers.",
		},
		{
			label: "Wide Events",
			title: "Wide Events",
			desc: "One rich event per request with tail sampling.",
		},
		{
			label: "Sampling",
			title: "Tail Sampling",
			desc: "Errors always kept. Normal traffic sampled.",
		},
		{ label: "Next.js", title: "Next.js", desc: "Console capture, error tracking, browser proxy." },
		{ label: "Browser", title: "Browser", desc: "Client-side SDK with console and error capture." },
		{ label: "Auth", title: "Auth", desc: "Three roles — ingest, read, admin." },
		{ label: "MCP", title: "MCP Server", desc: "AI agents search and query your logs." },
		{ label: "Archive", title: "S3 Archival", desc: "Parquet files, DuckDB hot + cold queries." },
		{ label: "CLI", title: "CLI", desc: "Tail, search, query, export from terminal." },
		{
			label: "Python",
			title: "Python SDK",
			desc: "Structured logs, wide events, context manager.",
		},
	];

	const examples = [
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";\n\nconst log = createLogger({\n  url: "http://localhost:3485",\n  service: "api",\n});\n\nlog.info("server started", { port: 3000 });\nlog.warn("slow query", { duration_ms: 1200, table: "users" });\nlog.error(new Error("connection failed"));\n\nconst reqLog = log.child({\n  traceId: "abc-123",\n  method: "POST",\n  path: "/users",\n});\nreqLog.info("request started");\nreqLog.info("auth passed", { userId: "u_42" });\n\nawait log.flush();`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";\n\nconst log = createLogger({\n  url: "http://localhost:3485",\n  service: "api",\n  sampleRate: 0.05,\n  slowThresholdMs: 500,\n});\n\nconst ev = log.event("http_request");\nev.request(req);\n\nconst user = await authenticate(req);\nev.set("user_id", user.id);\nif (user.tier === "enterprise") ev.keep();\n\ntry {\n  const result = await handleRequest(req);\n  ev.set("result_count", result.items.length);\n  ev.response(res);\n} catch (err) {\n  ev.error(err);\n}\n\nev.end();`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/client";\n\nconst log = createLogger({\n  url: "http://localhost:3485",\n  service: "api",\n  sampleRate: 0.05,\n  slowThresholdMs: 500,\n});\n\n// Errors always kept\nlog.event("http_request")\n  .request(req)\n  .error(new Error("DB timeout"))\n  .end();\n\n// Slow events kept automatically\nlog.event("http_request")\n  .request(req)\n  .end();\n\n// Force-keep VIP traffic\nconst ev = log.event("http_request");\nev.request(req);\nif (user.tier === "enterprise") ev.keep();\nev.end();`,
		},
		{
			lang: "typescript",
			code: `// instrumentation.ts\nimport { createLogger } from "relog.dev/next";\n\nconst relog = createLogger({\n  url: "http://localhost:3485",\n  service: "my-nextjs-app",\n});\n\nexport async function register() {\n  await relog.register();\n}\n\nexport const onRequestError = relog.onRequestError;\n\n// app/api/relog/route.ts\nimport { createBrowserProxy } from "relog.dev/next";\n\nexport const POST = createBrowserProxy({\n  url: process.env.RELOG_URL,\n  auth: process.env.RELOG_AUTH,\n  service: "my-nextjs-app",\n});`,
		},
		{
			lang: "typescript",
			code: `import { createLogger } from "relog.dev/browser";\n\nconst log = createLogger({\n  url: "https://logs.example.com",\n  auth: "ik_prod_abc123",\n  service: "web-app",\n  captureConsole: true,\n  captureErrors: true,\n});\n\nlog.info("page loaded", {\n  route: location.pathname,\n  referrer: document.referrer,\n});\n\n// Or proxy through your backend\nconst proxied = createLogger({\n  endpoint: "/api/relog",\n  service: "web-app",\n});`,
		},
		{
			lang: "bash",
			code: `# Start with three auth tiers\nbunx relog.dev start \\\n  --ingest-key ik_prod_abc123 \\\n  --read-key rk_prod_xyz789 \\\n  --admin-key ak_prod_secret456\n\n# Ingest: write-only\ncurl -X POST http://localhost:3485/ingest \\\n  -H "Authorization: Bearer ik_prod_abc123" \\\n  -H "Content-Type: application/json" \\\n  -d '[{"level":"info","message":"deployed","service":"api"}]'\n\n# Read: query, search, stream\ncurl http://localhost:3485/logs/search?q=deployed \\\n  -H "Authorization: Bearer rk_prod_xyz789"`,
		},
		{
			lang: "jsonc",
			code: `// ~/.claude/settings.json\n{\n  "mcpServers": {\n    "relog.dev": {\n      "command": "npx",\n      "args": [\n        "relog.dev", "mcp",\n        "--url", "http://localhost:3485",\n        "--auth", "rk_your_read_key"\n      ]\n    }\n  }\n}\n\n// Tools: search_logs, query_logs,\n// get_stats, tail_logs, get_context`,
		},
		{
			lang: "bash",
			code: `# Archive to S3 as Parquet\nbunx relog.dev archive --keep-days 7\n\n# Start with S3 for hot + cold queries\nbunx relog.dev start \\\n  --s3-endpoint https://s3.amazonaws.com \\\n  --s3-bucket my-logs \\\n  --s3-access-key AKIA... \\\n  --s3-secret-key ...\n\n# DuckDB merges SQLite + S3 Parquet\n# Works with AWS S3, R2, MinIO, B2`,
		},
		{
			lang: "bash",
			code: `# Stream logs in real-time\nbunx relog.dev tail --level error --service api\n\n# Full-text search\nbunx relog.dev search --grep "payment failed" --from 1h\n\n# Run SQL\nbunx relog.dev query --sql \\\n  "SELECT service, level, COUNT(*) as n\n   FROM logs\n   WHERE timestamp > datetime('now', '-1 hour')\n   GROUP BY service, level\n   ORDER BY n DESC"\n\n# Export and stats\nbunx relog.dev export --format csv --from 7d\nbunx relog.dev stats --from 24h`,
		},
		{
			lang: "python",
			code: `from relog import create_logger\n\nlog = create_logger(\n    url="http://localhost:3485",\n    service="api",\n    sample_rate=0.05,\n    slow_threshold_ms=500,\n)\n\nlog.info("server started", {"port": 3000})\nlog.warn("slow query", {"duration_ms": 1200})\nlog.error(ValueError("connection failed"))\n\nreq_log = log.child(trace_id="abc-123")\nreq_log.info("request started")\n\nev = log.event("http_request")\nev.request(method="POST", url="/users")\nev.set("user_id", "u_42")\ntry:\n    result = handle_request(request)\n    ev.response(status=200)\nexcept Exception as e:\n    ev.error(e)\nev.end()\n\nwith log.event("db_query") as ev:\n    ev.set("table", "orders")\n    rows = db.execute("SELECT * FROM orders")\n    ev.set("row_count", len(rows))\n\nlog.flush()`,
		},
	];

	return (
		<section className="max-w-5xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-4">Get started</h2>
			</Reveal>

			<Reveal delay={0.1}>
				<div className="flex items-center gap-0.5 mb-3 overflow-x-auto tabs-scroll pb-1 -mx-5 px-5 sm:mx-0 sm:px-0">
					{tabs.map((t, i) => (
						<button
							key={t.label}
							onClick={() => setTab(i)}
							className={`px-2.5 py-1 text-[12px] font-medium rounded-md transition-all cursor-pointer whitespace-nowrap ${tab === i ? "text-fg bg-white/[0.08]" : "text-muted hover:text-dim hover:bg-white/[0.03]"}`}
						>
							{t.label}
						</button>
					))}
				</div>

				<AnimatePresence mode="wait">
					<motion.div
						key={tab}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.2 }}
						className="mb-3"
					>
						<span className="text-[13px] font-medium text-fg">{tabs[tab]!.title}</span>
						<span className="text-[12px] text-muted ml-2">{tabs[tab]!.desc}</span>
					</motion.div>
				</AnimatePresence>

				<AnimatePresence mode="wait">
					<motion.div
						key={tab}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
					>
						<CodeBlock lang={examples[tab]!.lang} code={examples[tab]!.code} />
					</motion.div>
				</AnimatePresence>
			</Reveal>
		</section>
	);
}

// ─── Code block ──────────────────────────────────────────────────────
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

	if (html) {
		return (
			<div className="rounded-lg border border-white/[0.06] overflow-hidden">
				{/* shiki output from static code strings defined in this file */}
				<div
					className="[&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:leading-[1.7] [&_pre]:!bg-bg-code [&_code]:font-mono"
					dangerouslySetInnerHTML={{ __html: html }}
				/>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-white/[0.06] overflow-hidden">
			<pre className="p-4 overflow-x-auto bg-bg-code text-[12px] leading-[1.7]">
				<code className="text-fg/70 font-mono">{code}</code>
			</pre>
		</div>
	);
}

// ─── FAQ ─────────────────────────────────────────────────────────────
function FAQ() {
	const [open, setOpen] = useState<number | null>(null);

	const faqs = [
		{
			q: "Why not Datadog / Logtail / Axiom?",
			a: "Free, self-hosted, MIT licensed. No per-GB pricing, no vendor lock-in, no third-party data sharing. Your logs stay on your infrastructure.",
		},
		{
			q: "How does storage work?",
			a: "Single SQLite file with WAL mode for concurrent reads/writes. Indexed by level, service, project, branch, trace_id, and timestamp. No external databases needed.",
		},
		{
			q: "How does archival work?",
			a: "The archive command converts old logs to Parquet files on S3/R2/MinIO. DuckDB transparently queries both hot data (SQLite) and cold data (S3 Parquet) so you get unlimited retention without growing your local database.",
		},
		{
			q: "What are wide events?",
			a: "Instead of scattering log lines throughout a request, build one event per unit of work. Call .request(req) to auto-extract HTTP context, .set() to add fields, and .end() to emit a single record with all context plus duration_ms. Supports TC39 'using' for auto-emit on scope exit.",
		},
		{
			q: "How does tail sampling work?",
			a: "Set sampleRate (0–1) on the logger. The keep/drop decision happens after the event completes so it has full context. Errors are always kept. Events slower than slowThresholdMs are always kept. Call .keep() to force-keep VIP traffic. Sampled events include sample_rate in metadata for extrapolation.",
		},
		{
			q: "What does the MCP server do?",
			a: "AI agents (Claude Code, Cursor, etc.) query your logs via Model Context Protocol tool use. Five tools: search_logs (filter by level/service/time), query_logs (SQL), get_stats (volume/health), tail_logs (recent entries), and get_log_context (surrounding logs for a given ID).",
		},
		{
			q: "How do external sources work?",
			a: "Define sources in a YAML config file and pass --sources to the server. Each source has an adapter (GitHub Actions, Vercel, etc.), a poll interval, and adapter-specific config. The server polls each source on its interval, tracks a cursor in SQLite so it only fetches new data, and inserts directly into the database. Secrets use $ENV_VAR references so nothing is stored on disk.",
		},
		{
			q: "How does authentication work?",
			a: "Three roles with hierarchical access: ingest (write-only), read (query/stream/search), admin (all + prune/config). Bearer token auth with multiple keys per role — comma-separated flags or individually named env vars. Ideal for Docker/k8s with separate secrets per app.",
		},
	];

	return (
		<section className="max-w-3xl mx-auto px-5 sm:px-8 pb-14">
			<Reveal>
				<h2 className="text-lg font-semibold tracking-tight mb-4">FAQ</h2>
			</Reveal>
			<div className="space-y-1">
				{faqs.map((f, i) => (
					<Reveal key={f.q} delay={i * 0.03}>
						<button
							onClick={() => setOpen(open === i ? null : i)}
							className="w-full text-left rounded-lg border border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
						>
							<div className="flex items-center justify-between px-4 py-3">
								<span className="text-[13px] font-medium text-fg pr-3">{f.q}</span>
								<motion.span
									animate={{ rotate: open === i ? 45 : 0 }}
									transition={{ duration: 0.15 }}
									className="text-muted shrink-0 text-sm"
								>
									+
								</motion.span>
							</div>
							<AnimatePresence>
								{open === i && (
									<motion.div
										initial={{ height: 0, opacity: 0 }}
										animate={{ height: "auto", opacity: 1 }}
										exit={{ height: 0, opacity: 0 }}
										transition={{ duration: 0.2 }}
										className="overflow-hidden"
									>
										<p className="px-4 pb-3 text-[12px] text-muted leading-relaxed">{f.a}</p>
									</motion.div>
								)}
							</AnimatePresence>
						</button>
					</Reveal>
				))}
			</div>
		</section>
	);
}

// ─── Footer ──────────────────────────────────────────────────────────
function Footer() {
	return (
		<footer className="border-t border-white/[0.06]">
			<div className="max-w-5xl mx-auto px-5 sm:px-8 py-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
				<span className="text-muted/40">
					Built by{" "}
					<a
						href="https://linesofcode.dev"
						className="text-muted/60 hover:text-fg transition-colors"
					>
						linesofcode.dev
					</a>
				</span>
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
					<a href="https://x.com/linesofcode" className="hover:text-fg transition-colors">
						X
					</a>
					<a
						href="https://bsky.app/profile/linesofcode.bsky.social"
						className="hover:text-fg transition-colors"
					>
						Bluesky
					</a>
					<a
						href="https://linkedin.com/in/tim-mikeladze"
						className="hover:text-fg transition-colors"
					>
						LinkedIn
					</a>
				</div>
			</div>
		</footer>
	);
}

// ─── Icons ───────────────────────────────────────────────────────────
function GitHubIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

export default App;
