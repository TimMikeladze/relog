# relog.dev

A lightweight, self-hosted logging system for Bun. Ship structured logs from any application to a SQLite-backed server, then tail, search, query, and export them from the CLI or HTTP API. Includes an MCP server for AI agent integration.

## Key Features

- **Zero-dependency server** — single SQLite file, WAL mode, no Redis or external databases
- **Batching client SDK** — automatic batching, retries with exponential backoff, buffer overflow protection
- **Wide events** — build one event per request with all context, emit at the end with auto-duration and level escalation
- **Tail sampling** — client-side sampling that always keeps errors and slow requests, drops the rest at a configurable rate
- **Real-time streaming** — SSE-based log tailing with server-side filtering
- **Read-only SQL queries** — run arbitrary SELECT/EXPLAIN/PRAGMA against the log database
- **Distributed tracing** — first-class `trace_id` and `span_id` support
- **Project & branch tracking** — auto-detected from git, filterable across all endpoints
- **Deployment context** — first-class `version` and `deployment_id` fields for tracking releases
- **Child loggers** — inherit service, meta, and trace context from parent loggers
- **Role-based API keys** — three roles (ingest, read, admin) with hierarchical Bearer token auth; supports multiple keys per role for multi-app environments
- **Browser logging** — client-side logger with batched proxy delivery, error capture, and session tracking
- **Next.js integration** — drop-in console capture, request logging, error tracking, and browser proxy
- **MCP server** — AI agents (Claude Code, Cursor, etc.) can query logs via Model Context Protocol
- **Export** — JSON, CSV, and NDJSON export formats

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Your Application  │         │       relog.dev startr             │
│                     │         │                                  │
│  ┌───────────────┐  │  HTTP   │  ┌────────┐    ┌─────────────┐  │
│  │ relog.dev client│──┼────────┼─▶│ /ingest │───▶│             │  │
│  │  (Logger)     │  │  POST   │  └────────┘    │   SQLite    │  │
│  └───────────────┘  │         │  ┌────────┐    │   (WAL)     │  │
│   - batching        │         │  │ /logs   │◀───│             │  │
│   - retries         │         │  │ /query  │    │  ~/.relog/   │  │
│   - auto-flush      │         │  │ /stream │    └─────────────┘  │
└─────────────────────┘         │  │ /health │                     │
                                │  │ /prune  │                     │
┌─────────────────────┐         │  └────────┘                      │
│   Browser           │         │                                  │
│  ┌───────────────┐  │  fetch  │  Role-based API keys (optional)  │
│  │ relog.dev/     │  │ beacon  │  CORS (optional)                 │
│  │  browser      │──┼────┐    └──────────────────────────────────┘
│  └───────────────┘  │    │
│   - batching        │    │    ┌──────────────────────────────────┐
│   - sendBeacon      │    └───▶│   Your Server (proxy)            │
│   - error capture   │  POST   │   /api/relog ──▶ relog /ingest   │
└─────────────────────┘         └──────────────────────────────────┘

┌─────────────────────┐
│   relog.dev CLI      │  HTTP
│                     │────────▶  relog.dev startr
│  tail | search      │
│  query | export     │
│  stats | prune      │
│  mcp                │         ┌──────────────────────────────────┐
└─────────────────────┘         │     AI Agents (Claude, etc.)     │
                                │                                  │
┌─────────────────────┐  stdio  │  search_logs | query_logs        │
│ relog.dev mcp server │◀───────│  get_stats | tail_logs           │
│   (stdio transport) │────────▶│  get_log_context                 │
└─────────────────────┘         └──────────────────────────────────┘
```

## Install

```bash
bun add relog.dev
```

The `relog.dev` package includes the server, CLI, and client SDK. Import from the appropriate entrypoint:

```typescript
import { startServer } from "relog.dev"; // server
import { createLogger } from "relog.dev/client"; // client SDK
import { createMcpServer } from "relog.dev/mcp"; // MCP server
import { createLogger } from "relog.dev/next"; // Next.js integration
import { log } from "relog.dev/browser"; // Browser client
```

## Quick Start

Try it in 60 seconds — copy-paste this entire block into your terminal:

```bash
# terminal 1: start the server
bunx relog.dev start &
sleep 1

# send some logs
bunx relog.dev send --level info --message "user signed up" --service auth --project my-app --meta '{"userId":1}'
bunx relog.dev send --level info --message "order created" --service billing --project my-app --meta '{"orderId":"abc"}'
bunx relog.dev send --level warn --message "slow query detected" --service db --project my-app --meta '{"duration_ms":1200}'
bunx relog.dev send --level error --message "payment failed" --service billing --project my-app --meta '{"orderId":"abc","code":"CARD_DECLINED"}'
bunx relog.dev send --level debug --message "cache miss" --service api --project my-app

# search logs
bunx relog.dev search --level error
bunx relog.dev search --grep "order" --limit 5
bunx relog.dev search --service billing

# run SQL queries
bunx relog.dev query --sql "SELECT level, COUNT(*) as count FROM logs GROUP BY level"
bunx relog.dev query --sql "SELECT service, COUNT(*) as count FROM logs GROUP BY service" --format json

# view stats
bunx relog.dev stats

# export to file
bunx relog.dev export --output logs.json
cat logs.json

# clean up
kill %1 && rm -rf ~/.relog logs.json
```

### Using the SDK

Start the server:

```bash
bunx relog.dev start
# relog.dev startr listening on http://localhost:3485
```

Send logs from your app:

```typescript
import { createLogger } from "relog.dev/client";

const log = createLogger({
	url: "http://localhost:3485",
	service: "my-app",
	// project and branch are auto-detected from git
});

log.info("server started", { port: 3000 });
log.warn("slow query", { duration_ms: 1200 });
log.error(new Error("connection failed"));

// flush before exit
await log.flush();
```

Tail logs in real-time:

```bash
bunx relog.dev tail
```

## Client SDK

### `createLogger(options)`

| Option            | Type                     | Default          | Description                                                               |
| ----------------- | ------------------------ | ---------------- | ------------------------------------------------------------------------- |
| `url`             | `string`                 | —                | Server URL. Omit for console-only logging                                 |
| `service`         | `string`                 | —                | Service name attached to every log                                        |
| `level`           | `LogLevel`               | `"info"`         | Minimum level (`trace` `debug` `info` `warn` `error` `fatal`)             |
| `auth`            | `string`                 | `RELOG_AUTH` env | API key sent as Bearer token                                              |
| `console`         | `boolean`                | `true` in dev    | Print to stdout (`false` when `NODE_ENV=production`)                      |
| `project`         | `string`                 | auto (git)       | Project name. Also reads `RELOG_PROJECT` env                              |
| `branch`          | `string`                 | auto (git)       | Git branch. Also reads `RELOG_BRANCH` env                                 |
| `version`         | `string`                 | —                | App version (e.g. `"1.2.3"`, git SHA)                                     |
| `deploymentId`    | `string`                 | —                | Deployment identifier                                                     |
| `sampleRate`      | `number`                 | `1`              | Sample rate for wide events (0–1). Errors and slow events are always kept |
| `slowThresholdMs` | `number`                 | —                | Events slower than this (ms) are always kept regardless of sample rate    |
| `batchSize`       | `number`                 | `50`             | Logs per HTTP batch                                                       |
| `flushInterval`   | `number`                 | `5000`           | Auto-flush interval (ms)                                                  |
| `maxBufferSize`   | `number`                 | `10000`          | Max buffered logs before oldest are dropped                               |
| `meta`            | `object`                 | —                | Default metadata merged into every log                                    |
| `traceId`         | `string`                 | —                | Trace ID attached to every log                                            |
| `spanId`          | `string`                 | —                | Span ID attached to every log                                             |
| `onError`         | `(error, batch) => void` | —                | Custom error handler for failed sends                                     |

### Child Loggers

```typescript
const reqLog = log.child({ requestId: "abc-123", traceId: "t-1" });
reqLog.info("handling request"); // inherits service + meta from parent
```

Child loggers share the parent's transport (single HTTP connection) and inherit service name, log level, and console settings. Additional metadata is merged with the parent's.

### Log Levels

`trace` < `debug` < `info` < `warn` < `error` < `fatal`

Set via `level` option or `LOG_LEVEL` / `RELOG_LEVEL` env var.

### Project & Branch Auto-Detection

When `project` or `branch` aren't explicitly set, relog.dev infers them from git:

- **project**: Repository directory name via `git rev-parse --show-toplevel`
- **branch**: Current branch via `git rev-parse --abbrev-ref HEAD`

Override with env vars `RELOG_PROJECT` and `RELOG_BRANCH`, or pass them directly in logger options. Values are cached once per process.

### Wide Events

Instead of scattering log lines throughout a request, build one comprehensive event per unit of work and emit it at the end. This is the [wide event pattern](https://loggingsucks.com/) — optimized for querying, not writing.

```typescript
const ev = logger.event("http_request");
ev.request(req); // auto-extracts method, path, user-agent, trace ID from headers

const user = await authenticate(req);
ev.set("user_id", user.id);
ev.set("org_id", user.orgId);

try {
	const result = await handleRequest(req);
	ev.response(res); // auto-extracts status, escalates to error on 500+
	ev.set("response_size", result.length);
} catch (err) {
	ev.error(err); // records error details + auto-escalates level to "error"
}

ev.end(); // emits a single log record with all context + duration_ms
```

The emitted record contains everything: `message` is the event name, `meta` holds all accumulated key-value pairs plus `duration_ms` and `event: true`, and the `level` is auto-escalated based on recorded errors/warnings.

**`.request(req)` and `.response(res)`:** Auto-extract HTTP context from both Web API (`Request`/`Response`) and Node.js (`IncomingMessage`/`ServerResponse`) objects via duck-typing. Extracts `http_method`, `http_path`, `http_status`, `user_agent`, and trace IDs from headers. A response with status >= 500 auto-escalates the event level to `error`.

**Chainable API:**

```typescript
logger.event("checkout").set("user_id", "usr_123").set("cart_items", 3).end();
```

**Bulk set:**

```typescript
ev.set({ method: "POST", path: "/api/pay", user_id: "usr_1" });
```

**Auto-cleanup with `using` (TC39 Explicit Resource Management):**

```typescript
{
	using ev = logger.event("db_query");
	ev.set("table", "users");
	ev.set("query", "SELECT ...");
	// auto-emits on scope exit via Symbol.dispose
}
```

**Level escalation:** The event starts at `info`. Calling `.warn()` escalates to `warn`, `.error()` escalates to `error`. A `.response()` with status >= 500 also escalates to `error`. The level never downgrades — `error` always wins over `warn`.

**Inherits context:** Events created from child loggers automatically include all inherited metadata, service, project, branch, version, deployment ID, and trace IDs.

```typescript
const reqLog = log.child({ requestId: "abc-123", traceId: "t-1" });
const ev = reqLog.event("process_payment");
// ev already has requestId, service, project, branch, version, trace_id
ev.set("amount", 99.99);
ev.end();
```

**Console output for wide events shows duration inline:**

```
14:32:05.123 INFO  [my-app@main v1.2.3] [api] http_request (142.5ms) {"method":"POST","path":"/checkout","status":200}
```

### Tail Sampling

Tail sampling makes the keep/drop decision _after_ the event completes, so it has full context about what happened. This is the approach recommended by [loggingsucks.com](https://loggingsucks.com/) — always keep the important events, sample the rest.

```typescript
const log = createLogger({
	url: "http://localhost:3485",
	service: "api",
	sampleRate: 0.05, // keep 5% of normal events
	slowThresholdMs: 500, // always keep events slower than 500ms
});

// Errors are ALWAYS kept (level >= error)
// Slow events are ALWAYS kept (duration_ms > slowThresholdMs)
// Everything else: 5% chance of being kept

const ev = log.event("http_request");
ev.request(req);
// ... handle request ...
ev.response(res);
ev.end(); // sampling decision happens here, at the end
```

**Force-keep with `.keep()`:** Mark specific events as must-keep regardless of sample rate — useful for VIP traffic, flagged sessions, or feature flag rollouts:

```typescript
const ev = log.event("http_request");
ev.request(req);

if (user.tier === "enterprise") {
	ev.keep(); // always emitted, ignores sample rate
}

ev.end();
```

**Sampled events include `sample_rate` in metadata** so you can extrapolate totals in queries (e.g., 5 sampled events at 5% ≈ 100 actual events).

Sampling only applies to wide events (`logger.event()`), not individual log calls (`logger.info()`, etc.). When `sampleRate` is omitted or set to `1`, all events are kept (default behavior).

### Error Logging

Pass an `Error` object directly — the message, name, and stack trace are automatically extracted into metadata:

```typescript
log.error(new Error("connection failed"));
// message: "connection failed"
// meta: { error: "connection failed", name: "Error", stack: "..." }
```

### Console-Only Mode

Omit the `url` option to use relog.dev as a structured console logger with no network transport:

```typescript
const log = createLogger({ service: "my-app" });
log.info("local only"); // prints colored output to stdout
```

### Graceful Shutdown

The client registers `SIGINT` and `SIGTERM` handlers to flush all active transports before exit. You can also manually flush and destroy:

```typescript
await log.flush(); // flush pending logs
await log.destroy(); // flush + stop the transport
```

## CLI

All commands accept `--url` (default `http://localhost:3485`) and `--auth` for Bearer token authentication (also reads `RELOG_AUTH` env).

### `relog.dev start`

Start the log server.

```bash
relog.dev start --port 3485 --admin-key mykey --cors true
```

| Option                | Default             | Description                                                                          |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `--port`              | `3485`              | Port to listen on                                                                    |
| `--db`                | `~/.relog/relog.db` | SQLite database file path                                                            |
| `--ingest-key`        | —                   | API key(s) for ingest role, comma-separated. Also reads `RELOG_INGEST_KEY*` env vars |
| `--read-key`          | —                   | API key(s) for read role, comma-separated. Also reads `RELOG_READ_KEY*` env vars     |
| `--admin-key`         | —                   | API key(s) for admin role, comma-separated. Also reads `RELOG_ADMIN_KEY*` env vars   |
| `--key-prefix-length` | `6`                 | Number of API key characters stored per log for auditing (0 to disable)              |
| `--cors`              | `false`             | Enable CORS headers                                                                  |

**Role hierarchy:** admin > read > ingest. An admin key can access all routes, a read key can also ingest, and an ingest key can only write logs. If no keys are configured, auth is disabled.

**Multiple keys:** Each role supports multiple keys. You can comma-separate them in a single flag, or use individually named env vars — the server automatically picks up any env var matching the prefix:

```bash
# via CLI flags (comma-separated)
relog.dev start \
  --ingest-key "app1-key,app2-key,app3-key" \
  --admin-key "ops-key,ci-key"

# via env vars (auto-discovered by prefix)
RELOG_INGEST_KEY_APP1=key1 \
RELOG_INGEST_KEY_APP2=key2 \
RELOG_ADMIN_KEY=ops-key \
RELOG_ADMIN_KEY_CI=ci-key \
relog.dev start
```

This lets you issue separate keys per app or team and revoke individual keys without affecting others. Ideal for Docker/k8s where each key can be injected as a separate secret.

### `relog.dev send`

Send a log entry to the server.

```bash
relog.dev send --message "hello world"
relog.dev send --level error --message "connection failed" --service api --meta '{"code":500}'
```

| Option       | Default    | Description                                               |
| ------------ | ---------- | --------------------------------------------------------- |
| `--message`  | (required) | Log message                                               |
| `--level`    | `info`     | Log level (`trace` `debug` `info` `warn` `error` `fatal`) |
| `--service`  | —          | Service name                                              |
| `--project`  | —          | Project name                                              |
| `--branch`   | —          | Git branch                                                |
| `--meta`     | —          | JSON metadata object                                      |
| `--host`     | —          | Hostname                                                  |
| `--pid`      | —          | Process ID                                                |
| `--trace-id` | —          | Trace ID                                                  |
| `--span-id`  | —          | Span ID                                                   |

### `relog.dev tail`

Stream logs in real-time via SSE. Automatically reconnects on connection loss with exponential backoff (up to 10 retries).

```bash
relog.dev tail --level error --service my-app --project my-project --branch main
```

| Option      | Description            |
| ----------- | ---------------------- |
| `--level`   | Filter by log level    |
| `--service` | Filter by service name |
| `--project` | Filter by project      |
| `--branch`  | Filter by branch       |

### `relog.dev search`

Search logs with filters.

```bash
relog.dev search --grep "timeout" --level error --from 1h --project my-app --branch main --limit 50
```

| Option      | Default | Description                                                |
| ----------- | ------- | ---------------------------------------------------------- |
| `--grep`    | —       | Search message text                                        |
| `--level`   | —       | Filter by log level                                        |
| `--service` | —       | Filter by service name                                     |
| `--project` | —       | Filter by project                                          |
| `--branch`  | —       | Filter by branch                                           |
| `--from`    | —       | Start time (ISO 8601 or relative: `30s`, `5m`, `1h`, `7d`) |
| `--to`      | —       | End time (ISO 8601)                                        |
| `--limit`   | `100`   | Max results to return                                      |

### `relog.dev query`

Run read-only SQL directly against the log database. Only `SELECT`, `EXPLAIN`, and safe `PRAGMA` statements are allowed.

```bash
relog.dev query --sql "SELECT level, COUNT(*) as count FROM logs GROUP BY level"
relog.dev query --sql "SELECT * FROM logs WHERE service = 'api' ORDER BY id DESC LIMIT 10" --format json
```

| Option     | Default    | Description                              |
| ---------- | ---------- | ---------------------------------------- |
| `--sql`    | (required) | SQL query to execute                     |
| `--format` | `table`    | Output format: `table`, `json`, or `csv` |

### `relog.dev stats`

Show log counts, database size, and uptime.

```bash
relog.dev stats
```

### `relog.dev export`

Export logs to a file.

```bash
relog.dev export --output logs.json
relog.dev export --output logs.csv --format csv --from 2025-01-01T00:00:00Z --project my-app
```

| Option      | Default    | Description                               |
| ----------- | ---------- | ----------------------------------------- |
| `--output`  | (required) | Output file path                          |
| `--format`  | `json`     | Export format: `json`, `csv`, or `ndjson` |
| `--from`    | —          | Start time (ISO 8601)                     |
| `--to`      | —          | End time (ISO 8601)                       |
| `--project` | —          | Filter by project                         |
| `--branch`  | —          | Filter by branch                          |
| `--limit`   | `10000`    | Max logs to export                        |

### `relog.dev prune`

Delete old logs. Prompts for confirmation unless `--yes` is passed.

```bash
relog.dev prune --keep-days 30
relog.dev prune --before 2025-01-01T00:00:00Z --yes
```

| Option        | Description                           |
| ------------- | ------------------------------------- |
| `--before`    | Delete logs before this ISO timestamp |
| `--keep-days` | Keep logs from the last N days        |
| `--yes`       | Skip confirmation prompt              |

### `relog.dev mcp`

Start an MCP server for AI agent integration (see [MCP Server](#mcp-server) below).

```bash
relog.dev mcp --url http://localhost:3485 --auth my-read-key
```

## MCP Server

relog.dev includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI agents query your logs through natural tool use. The MCP server connects to a running relog.dev HTTP server and exposes tools over stdio.

### Setup with Claude Code

Add to `~/.claude/settings.json`:

```json
{
	"mcpServers": {
		"relog.dev": {
			"command": "npx",
			"args": ["relog.dev", "mcp", "--url", "http://localhost:3485"]
		}
	}
}
```

With auth:

```json
{
	"mcpServers": {
		"relog.dev": {
			"command": "npx",
			"args": ["relog.dev", "mcp", "--url", "http://localhost:3485", "--auth", "my-read-key"]
		}
	}
}
```

### Available Tools

| Tool              | Description                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `search_logs`     | Search and filter logs by level, service, project, branch, version, deployment_id, text, and time range |
| `query_logs`      | Run read-only SQL against the logs table                                                                |
| `get_stats`       | Server health, log counts by level, service breakdown, and project breakdown                            |
| `tail_logs`       | Get the most recent logs                                                                                |
| `get_log_context` | Get logs surrounding a specific log ID (before/after context)                                           |

### Programmatic Use

```typescript
import { createMcpServer } from "relog.dev/mcp";

const server = createMcpServer({
	url: "http://localhost:3485",
	auth: "my-read-key",
});
```

### Using Without MCP

AI agents that can make HTTP calls can use the REST API directly:

- `GET /logs?level=error&from=1h&project=my-app` — search and filter logs
- `POST /query` with `{ "sql": "..." }` — run SQL queries
- `GET /health` — check server status

The MCP server is preferred when available since agents get typed tool schemas with descriptions automatically.

## Next.js Integration

relog.dev provides a drop-in integration for Next.js that captures console output, HTTP requests, and unhandled errors with just two files.

### Setup

**`instrumentation.ts`** (project root):

```typescript
import { createLogger } from "relog.dev/next";

const relog = createLogger({
	url: "http://localhost:3485",
	service: "my-app",
});

export async function register() {
	await relog.register();
}

export const onRequestError = relog.onRequestError;
```

**`middleware.ts`** (project root):

```typescript
import { relogMiddleware } from "relog.dev/next";
import { NextResponse } from "next/server";

export default relogMiddleware(() => NextResponse.next());
```

That's it. All `console.log/warn/error/info/debug` calls on the server are captured, every HTTP request is logged with method/path/status/duration, and unhandled errors in server components, server actions, and route handlers are tracked automatically.

### Explicit Structured Logging

Use the `log` export anywhere in server code for explicit structured logs:

```typescript
import { log } from "relog.dev/next";

log.info("user signed in", { userId: "123" });
log.error(new Error("payment failed"), { orderId: "abc" });
```

### Wrapping Existing Middleware

Pass your middleware function to `relogMiddleware`. The trace ID header is automatically added to the response:

```typescript
import { relogMiddleware } from "relog.dev/next";

function myMiddleware(request: Request) {
	// your logic
	return new Response(null, { status: 200 });
}

export default relogMiddleware(myMiddleware);
```

### Configuration

| Option           | Type       | Default                                    | Description                             |
| ---------------- | ---------- | ------------------------------------------ | --------------------------------------- |
| `url`            | `string`   | `RELOG_URL` env or `http://localhost:3485` | relog.dev startr URL                    |
| `service`        | `string`   | `"next"`                                   | Service name                            |
| `auth`           | `string`   | `RELOG_AUTH` env                           | API key (sent as Bearer token)          |
| `level`          | `LogLevel` | `"info"`                                   | Minimum log level                       |
| `captureConsole` | `boolean`  | `true`                                     | Patch console methods to capture output |
| `traceHeader`    | `string`   | `"x-trace-id"`                             | Response header name for trace IDs      |
| `version`        | `string`   | —                                          | App version                             |
| `deploymentId`   | `string`   | —                                          | Deployment identifier                   |
| `batchSize`      | `number`   | `50`                                       | Logs per HTTP batch                     |
| `flushInterval`  | `number`   | `5000`                                     | Auto-flush interval (ms)                |

### How It Works

- **Console patching**: `register()` intercepts `console.log/info/warn/error/debug`, forwarding each call to both the terminal (original behavior preserved) and the relog.dev transport. A recursion guard prevents infinite loops when the transport itself logs warnings.
- **Request logging**: The middleware logs every request with method, path, status code, duration, and a generated trace ID. The trace ID is also set as an `x-trace-id` response header.
- **Error tracking**: `onRequestError` is a Next.js instrumentation hook that catches unhandled errors from server components, server actions, and route handlers, logging them with full route context.
- **Edge runtime**: The middleware detects Edge runtime (`NEXT_RUNTIME === "edge"`) and sends logs directly via `fetch` instead of using the full Logger/Transport stack, avoiding Node.js API dependencies.

## Browser Logging

relog.dev provides a browser-safe logger that sends logs through a proxy endpoint on your own server. This keeps the relog server URL and API keys hidden from the client and avoids CORS issues.

### Zero-Config Usage

```typescript
import { log } from "relog.dev/browser";

log.info("page loaded");
log.error("checkout failed", { orderId: "abc" });
```

The singleton auto-initializes on first use. Logs are batched and sent to `/api/relog` on the same origin.

### Configured Usage

```typescript
import { createLogger } from "relog.dev/browser";

const log = createLogger({
	endpoint: "/api/logs",
	project: "my-app",
	service: "web",
	captureConsole: true,
});
```

### Browser Proxy (Next.js)

The browser logger sends logs to a proxy on your server. For Next.js App Router, create the proxy route with a single line:

**`app/api/relog/route.ts`**:

```typescript
import { createBrowserProxy } from "relog.dev/next";

export const POST = createBrowserProxy();
```

The proxy reads `RELOG_URL` and `RELOG_AUTH` from environment variables and forwards logs to the relog server. You can customize it:

```typescript
export const POST = createBrowserProxy({
	url: "http://relog:3485",
	auth: "my-ingest-key",
	service: "web-client",
	maxBatchSize: 50,
});
```

For non-Next.js servers, implement a POST endpoint that accepts a JSON array of log entries and forwards them to your relog server's `/ingest` endpoint.

### Auto-Enrichment

Every browser log is automatically enriched with:

| Field             | Source                | Description                                |
| ----------------- | --------------------- | ------------------------------------------ |
| `host`            | `location.hostname`   | Current hostname                           |
| `meta.url`        | `location.href`       | Full page URL                              |
| `meta.user_agent` | `navigator.userAgent` | Browser user agent                         |
| `meta.session_id` | `sessionStorage`      | Random ID persisted per tab session        |
| `meta.source`     | `"browser"`           | Identifies logs as coming from the browser |

### Error Capture

By default, `captureErrors: true` hooks `window.onerror` and `unhandledrejection` to automatically log uncaught errors and promise rejections.

### Configuration

| Option           | Type       | Default        | Description                                     |
| ---------------- | ---------- | -------------- | ----------------------------------------------- |
| `endpoint`       | `string`   | `"/api/relog"` | Proxy endpoint path on the same origin          |
| `level`          | `LogLevel` | `"info"`       | Minimum log level                               |
| `service`        | `string`   | —              | Service name                                    |
| `project`        | `string`   | —              | Project name                                    |
| `version`        | `string`   | —              | App version                                     |
| `deploymentId`   | `string`   | —              | Deployment identifier                           |
| `meta`           | `object`   | —              | Default metadata merged into every log          |
| `batchSize`      | `number`   | `25`           | Logs per HTTP batch                             |
| `flushInterval`  | `number`   | `3000`         | Auto-flush interval (ms)                        |
| `captureErrors`  | `boolean`  | `true`         | Capture `window.onerror` + `unhandledrejection` |
| `captureConsole` | `boolean`  | `false`        | Patch console methods to forward to relog       |

### Transport Behavior

- Logs are batched with `setInterval` and sent via `fetch` with `keepalive: true`
- On page hide (`visibilitychange` + `pagehide`), remaining logs flush via `navigator.sendBeacon`
- `sendBeacon` payloads are chunked at 60KB to stay under browser limits
- Failed fetches get a single retry before being dropped

### Wide Events (Browser)

The browser logger also supports wide events:

```typescript
import { log } from "relog.dev/browser";

const ev = log.event("page_interaction");
ev.set("page", "/checkout");
ev.set("action", "purchase");
ev.set("items", 3);
ev.end(); // emits one event with duration_ms
```

### Child Loggers

```typescript
import { log } from "relog.dev/browser";

const pageLog = log.child({ page: "/checkout" });
pageLog.info("step completed", { step: 2 });
```

Child loggers share the parent's transport and inherit all bound metadata.

## HTTP API

| Method | Path            | Description                               |
| ------ | --------------- | ----------------------------------------- |
| `POST` | `/ingest`       | Send log records (single object or array) |
| `GET`  | `/logs`         | Search logs with query params             |
| `GET`  | `/stream`       | SSE stream of new logs                    |
| `POST` | `/query`        | Run read-only SQL                         |
| `POST` | `/query/stream` | Streaming SQL query results (NDJSON)      |
| `POST` | `/prune`        | Delete logs before timestamp              |
| `GET`  | `/health`       | Server health                             |

All endpoints (except `/health`) require a Bearer token via `Authorization: Bearer <key>` when API keys are configured. Routes are protected by role: `ingest` for `/ingest`, `read` for `/logs`, `/query`, `/query/stream`, `/stream`, and `admin` for `/prune`, `/archive`.

### `POST /ingest`

Send one or more log entries. Accepts a single object or an array.

```bash
curl -X POST http://localhost:3485/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "level": "info",
    "message": "User signed in",
    "service": "auth",
    "meta": { "userId": 42 },
    "project": "my-app",
    "branch": "main"
  }'
```

| Field           | Required | Description                                        |
| --------------- | -------- | -------------------------------------------------- |
| `level`         | yes      | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `message`       | yes      | Log message string                                 |
| `timestamp`     | no       | ISO 8601 timestamp (server time if omitted)        |
| `meta`          | no       | Arbitrary metadata object                          |
| `service`       | no       | Service name                                       |
| `host`          | no       | Hostname                                           |
| `pid`           | no       | Process ID                                         |
| `trace_id`      | no       | Trace ID for distributed tracing                   |
| `span_id`       | no       | Span ID for distributed tracing                    |
| `project`       | no       | Project name                                       |
| `branch`        | no       | Git branch                                         |
| `version`       | no       | App version                                        |
| `deployment_id` | no       | Deployment identifier                              |

### `GET /logs`

Search and filter logs.

```bash
curl "http://localhost:3485/logs?level=error&from=1h&service=api&project=my-app&limit=50"
```

| Param           | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `level`         | Filter by log level                                         |
| `service`       | Filter by service name                                      |
| `project`       | Filter by project                                           |
| `branch`        | Filter by branch                                            |
| `version`       | Filter by version                                           |
| `deployment_id` | Filter by deployment ID                                     |
| `grep`          | Text search in messages                                     |
| `from`          | Start time — ISO 8601 or relative (`30s`, `5m`, `1h`, `7d`) |
| `to`            | End time — ISO 8601 or relative                             |
| `limit`         | Max results (default 100, max 10000)                        |
| `offset`        | Pagination offset                                           |

Returns `{ rows, total, limit, offset }`.

### `GET /stream`

SSE stream of new logs in real-time.

```bash
curl -N "http://localhost:3485/stream?level=error&project=my-app"
```

| Param           | Description             |
| --------------- | ----------------------- |
| `level`         | Filter by log level     |
| `service`       | Filter by service name  |
| `trace_id`      | Filter by trace ID      |
| `project`       | Filter by project       |
| `branch`        | Filter by branch        |
| `version`       | Filter by version       |
| `deployment_id` | Filter by deployment ID |

### `POST /query`

Run read-only SQL against the logs table. A `LIMIT` is auto-appended if missing.

```bash
curl -X POST http://localhost:3485/query \
  -H "Content-Type: application/json" \
  -d '{ "sql": "SELECT level, COUNT(*) as count FROM logs GROUP BY level" }'
```

Supports parameterized queries:

```json
{ "sql": "SELECT * FROM logs WHERE service = ? LIMIT ?", "params": ["api", 10] }
```

Returns `{ rows, count, time_ms }`.

### `POST /query/stream`

Same as `/query` but streams results as NDJSON. Useful for large result sets.

### `POST /prune`

Delete logs before a timestamp (epoch milliseconds).

```json
{ "before": 1700000000000 }
```

### `GET /health`

Returns `{ ok, uptime, db_size_bytes, log_count }`.

## Database Schema

```sql
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  service TEXT,
  host TEXT,
  pid INTEGER,
  trace_id TEXT,
  span_id TEXT,
  project TEXT,
  branch TEXT,
  version TEXT,
  deployment_id TEXT,
  key_prefix TEXT,
  created_at INTEGER NOT NULL
);
```

Indexed on: `created_at`, `level`, `service`, `trace_id`, `project`, `branch`, `version`, `deployment_id`, `(level, created_at)`, `(service, created_at)`, `(project, branch, created_at)`.

## Programmatic Server

```typescript
import { startServer } from "relog.dev";

const { server, db, streamManager, shutdown } = startServer({
	port: 3485,
	dbPath: "~/.relog/relog.db",
	ingestKeys: ["key-for-apps"],
	readKeys: ["key-for-agents"],
	adminKeys: ["key-for-admin"],
	cors: true,
});

// later
shutdown();
```

### `ServerConfig`

| Option             | Type                            | Default   | Description                                         |
| ------------------ | ------------------------------- | --------- | --------------------------------------------------- |
| `port`             | `number`                        | —         | Port to listen on                                   |
| `dbPath`           | `string`                        | —         | SQLite database file path                           |
| `ingestKeys`       | `string[]`                      | —         | API key(s) for ingest role                          |
| `readKeys`         | `string[]`                      | —         | API key(s) for read role (includes ingest)          |
| `adminKeys`        | `string[]`                      | —         | API key(s) for admin role (includes all)            |
| `keyPrefixLength`  | `number`                        | `6`       | Characters of API key stored per log (0 to disable) |
| `cors`             | `boolean \| string \| string[]` | —         | CORS origin(s) or `true` for `*`                    |
| `maxBodySize`      | `number`                        | `5242880` | Max request body size in bytes (5 MB)               |
| `maxBatchSize`     | `number`                        | `1000`    | Max log entries per ingest request                  |
| `streamDebounceMs` | `number`                        | `50`      | Debounce interval for SSE stream updates            |

## Environment Variables

| Variable                    | Description                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `RELOG_URL`                 | Default relog.dev startr URL for the Next.js integration                           |
| `RELOG_AUTH`                | Default API key (Bearer token) for client, CLI, and MCP commands                   |
| `RELOG_INGEST_KEY*`         | API key(s) for ingest role — any env starting with `RELOG_INGEST_KEY` is collected |
| `RELOG_READ_KEY*`           | API key(s) for read role — any env starting with `RELOG_READ_KEY` is collected     |
| `RELOG_ADMIN_KEY*`          | API key(s) for admin role — any env starting with `RELOG_ADMIN_KEY` is collected   |
| `LOG_LEVEL` / `RELOG_LEVEL` | Default log level for the client SDK                                               |
| `RELOG_PROJECT`             | Override auto-detected project name                                                |
| `RELOG_BRANCH`              | Override auto-detected git branch                                                  |
| `NODE_ENV`                  | When set to `production`, console output is disabled by default                    |

## Testing Locally

### 1. Start the server

```bash
# from source
bun src/cli.ts serve

# or after building
bun ./dist/cli.js serve

# with auth (role-based API keys)
bun src/cli.ts serve --admin-key mykey
```

### 2. Send logs

```bash
# via CLI
bun src/cli.ts send --message "hello world"
bun src/cli.ts send --level error --message "something broke" --service api --project my-app --branch main
bun src/cli.ts send --level info --message "user signed in" --meta '{"userId":42}'
bun src/cli.ts send --level debug --message "trace test" --trace-id t-123 --span-id s-456

# via curl (for batches)
curl -X POST http://localhost:3485/ingest \
  -H "Content-Type: application/json" \
  -d '[
    {"level":"info","message":"batch 1","service":"api"},
    {"level":"warn","message":"batch 2","service":"api"},
    {"level":"error","message":"batch 3","service":"api","meta":{"code":500}}
  ]'
```

### 3. Use the CLI commands

All CLI commands connect to the server over HTTP. Pass `--auth <api-key>` if auth is enabled.

```bash
# search logs
bun src/cli.ts search --grep "hello" --level info --limit 10
bun src/cli.ts search --level error --service api --from 1h
bun src/cli.ts search --project my-app --branch main

# tail logs in real-time
bun src/cli.ts tail
bun src/cli.ts tail --level error --service api
bun src/cli.ts tail --project my-app --branch main

# run SQL queries
bun src/cli.ts query --sql "SELECT level, COUNT(*) as count FROM logs GROUP BY level"
bun src/cli.ts query --sql "SELECT * FROM logs WHERE level = 'error' ORDER BY id DESC LIMIT 5" --format json
bun src/cli.ts query --sql "SELECT service, COUNT(*) as count FROM logs GROUP BY service" --format csv

# view stats
bun src/cli.ts stats

# export logs to a file
bun src/cli.ts export --output logs.json
bun src/cli.ts export --output logs.csv --format csv --project my-app
bun src/cli.ts export --output logs.ndjson --format ndjson --from 2025-01-01T00:00:00Z

# prune old logs
bun src/cli.ts prune --keep-days 30
bun src/cli.ts prune --before 2025-01-01T00:00:00Z --yes
```

### 4. Using curl directly

```bash
# query logs
curl "http://localhost:3485/logs?level=error&service=api&project=my-app"
curl "http://localhost:3485/logs?grep=hello&limit=10"
curl "http://localhost:3485/logs?from=1h"

# SQL query
curl -X POST http://localhost:3485/query \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT level, COUNT(*) as count FROM logs GROUP BY level"}'

# SSE stream
curl -N http://localhost:3485/stream
curl -N "http://localhost:3485/stream?level=error&service=api"

# health check
curl http://localhost:3485/health

# prune logs older than 7 days
curl -X POST http://localhost:3485/prune \
  -H "Content-Type: application/json" \
  -d "{\"before\":$(( $(date +%s) * 1000 - 604800000 ))}"
```

With auth enabled, add the header to curl requests:

```bash
curl -H "Authorization: Bearer my-admin-key" http://localhost:3485/health
```

## Development

```bash
git clone https://github.com/TimMikeladze/relog.git
cd relog
bun install
```

| Command              | Description                         |
| -------------------- | ----------------------------------- |
| `bun run build`      | Build with bunup                    |
| `bun run dev`        | Build in watch mode                 |
| `bun test`           | Run tests                           |
| `bun test --watch`   | Run tests in watch mode             |
| `bun run lint`       | Run oxlint                          |
| `bun run format`     | Run oxfmt                           |
| `bun run type-check` | TypeScript type checking            |
| `bun run release`    | Bump version, commit, push, and tag |

## License

MIT
