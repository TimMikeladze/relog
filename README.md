# relog

A lightweight, self-hosted logging system for Bun. Ship structured logs from any application to a SQLite-backed server, then tail, search, query, and export them from the CLI or HTTP API. Includes an MCP server for AI agent integration.

## Key Features

- **Zero-dependency server** — single SQLite file, WAL mode, no Redis or external databases
- **Batching client SDK** — automatic batching, retries with exponential backoff, buffer overflow protection
- **Real-time streaming** — SSE-based log tailing with server-side filtering
- **Read-only SQL queries** — run arbitrary SELECT/EXPLAIN/PRAGMA against the log database
- **Distributed tracing** — first-class `trace_id` and `span_id` support
- **Project & branch tracking** — auto-detected from git, filterable across all endpoints
- **Child loggers** — inherit service, meta, and trace context from parent loggers
- **Basic auth** — optional timing-safe authentication on all endpoints
- **Next.js integration** — drop-in console capture, request logging, and error tracking
- **MCP server** — AI agents (Claude Code, Cursor, etc.) can query logs via Model Context Protocol
- **Export** — JSON, CSV, and NDJSON export formats

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Your Application  │         │         relog server              │
│                     │         │                                  │
│  ┌───────────────┐  │  HTTP   │  ┌────────┐    ┌─────────────┐  │
│  │  relog client  │──┼────────┼─▶│ /ingest │───▶│             │  │
│  │  (Logger)     │  │  POST   │  └────────┘    │   SQLite    │  │
│  └───────────────┘  │         │  ┌────────┐    │   (WAL)     │  │
│   - batching        │         │  │ /logs   │◀───│             │  │
│   - retries         │         │  │ /query  │    │  relog.db   │  │
│   - auto-flush      │         │  │ /stream │    └─────────────┘  │
└─────────────────────┘         │  │ /health │                     │
                                │  │ /prune  │                     │
┌─────────────────────┐         │  └────────┘                      │
│     relog CLI        │  HTTP   │                                  │
│                     │────────▶│  Basic auth (optional)           │
│  tail | search      │         │  CORS (optional)                 │
│  query | export     │         └──────────────────────────────────┘
│  stats | prune      │
│  mcp                │         ┌──────────────────────────────────┐
└─────────────────────┘         │     AI Agents (Claude, etc.)     │
                                │                                  │
┌─────────────────────┐  stdio  │  search_logs | query_logs        │
│   relog mcp server   │◀───────│  get_stats | tail_logs           │
│   (stdio transport) │────────▶│  get_log_context                 │
└─────────────────────┘         └──────────────────────────────────┘
```

## Install

```bash
bun add relog
```

The `relog` package includes the server, CLI, and client SDK. Import from the appropriate entrypoint:

```typescript
import { startServer } from "relog";          // server
import { createLogger } from "relog/client";  // client SDK
import { createMcpServer } from "relog/mcp";  // MCP server
import { withRelog } from "relog/next";       // Next.js integration
```

## Quick Start

Start the server:

```bash
bunx relog serve
# relog server listening on http://localhost:3485
```

Send logs from your app:

```typescript
import { createLogger } from "relog/client";

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
bunx relog tail
```

## Client SDK

### `createLogger(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Server URL. Omit for console-only logging |
| `service` | `string` | — | Service name attached to every log |
| `level` | `LogLevel` | `"info"` | Minimum level (`trace` `debug` `info` `warn` `error` `fatal`) |
| `auth` | `string` | `RELOG_AUTH` env | Basic auth credentials (`user:pass`) |
| `console` | `boolean` | `true` in dev | Print to stdout (`false` when `NODE_ENV=production`) |
| `project` | `string` | auto (git) | Project name. Also reads `RELOG_PROJECT` env |
| `branch` | `string` | auto (git) | Git branch. Also reads `RELOG_BRANCH` env |
| `batchSize` | `number` | `50` | Logs per HTTP batch |
| `flushInterval` | `number` | `5000` | Auto-flush interval (ms) |
| `maxBufferSize` | `number` | `10000` | Max buffered logs before oldest are dropped |
| `meta` | `object` | — | Default metadata merged into every log |
| `traceId` | `string` | — | Trace ID attached to every log |
| `spanId` | `string` | — | Span ID attached to every log |
| `onError` | `(error, batch) => void` | — | Custom error handler for failed sends |

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

When `project` or `branch` aren't explicitly set, relog infers them from git:

- **project**: Repository directory name via `git rev-parse --show-toplevel`
- **branch**: Current branch via `git rev-parse --abbrev-ref HEAD`

Override with env vars `RELOG_PROJECT` and `RELOG_BRANCH`, or pass them directly in logger options. Values are cached once per process.

### Error Logging

Pass an `Error` object directly — the message, name, and stack trace are automatically extracted into metadata:

```typescript
log.error(new Error("connection failed"));
// message: "connection failed"
// meta: { error: "connection failed", name: "Error", stack: "..." }
```

### Console-Only Mode

Omit the `url` option to use relog as a structured console logger with no network transport:

```typescript
const log = createLogger({ service: "my-app" });
log.info("local only"); // prints colored output to stdout
```

### Graceful Shutdown

The client registers `SIGINT` and `SIGTERM` handlers to flush all active transports before exit. You can also manually flush and destroy:

```typescript
await log.flush();   // flush pending logs
await log.destroy(); // flush + stop the transport
```

## CLI

All commands accept `--url` (default `http://localhost:3485`) and `--auth` for basic auth (also reads `RELOG_AUTH` env).

### `relog serve`

Start the log server.

```bash
relog serve --port 3485 --db relog.db --auth admin:secret --cors true
```

| Option | Default | Description |
|---|---|---|
| `--port` | `3485` | Port to listen on |
| `--db` | `relog.db` | SQLite database file path |
| `--auth` | — | Basic auth credentials (`user:pass`) |
| `--cors` | `false` | Enable CORS headers |

### `relog tail`

Stream logs in real-time via SSE. Automatically reconnects on connection loss with exponential backoff (up to 10 retries).

```bash
relog tail --level error --service my-app --project my-project --branch main
```

| Option | Description |
|---|---|
| `--level` | Filter by log level |
| `--service` | Filter by service name |
| `--project` | Filter by project |
| `--branch` | Filter by branch |

### `relog search`

Search logs with filters.

```bash
relog search --grep "timeout" --level error --from 1h --project my-app --branch main --limit 50
```

| Option | Default | Description |
|---|---|---|
| `--grep` | — | Search message text |
| `--level` | — | Filter by log level |
| `--service` | — | Filter by service name |
| `--project` | — | Filter by project |
| `--branch` | — | Filter by branch |
| `--from` | — | Start time (ISO 8601 or relative: `30s`, `5m`, `1h`, `7d`) |
| `--to` | — | End time (ISO 8601) |
| `--limit` | `100` | Max results to return |

### `relog query`

Run read-only SQL directly against the log database. Only `SELECT`, `EXPLAIN`, and safe `PRAGMA` statements are allowed.

```bash
relog query --sql "SELECT level, COUNT(*) as count FROM logs GROUP BY level"
relog query --sql "SELECT * FROM logs WHERE service = 'api' ORDER BY id DESC LIMIT 10" --format json
```

| Option | Default | Description |
|---|---|---|
| `--sql` | (required) | SQL query to execute |
| `--format` | `table` | Output format: `table`, `json`, or `csv` |

### `relog stats`

Show log counts, database size, and uptime.

```bash
relog stats
```

### `relog export`

Export logs to a file.

```bash
relog export --output logs.json
relog export --output logs.csv --format csv --from 2025-01-01T00:00:00Z --project my-app
```

| Option | Default | Description |
|---|---|---|
| `--output` | (required) | Output file path |
| `--format` | `json` | Export format: `json`, `csv`, or `ndjson` |
| `--from` | — | Start time (ISO 8601) |
| `--to` | — | End time (ISO 8601) |
| `--project` | — | Filter by project |
| `--branch` | — | Filter by branch |
| `--limit` | `10000` | Max logs to export |

### `relog prune`

Delete old logs. Prompts for confirmation unless `--yes` is passed.

```bash
relog prune --keep-days 30
relog prune --before 2025-01-01T00:00:00Z --yes
```

| Option | Description |
|---|---|
| `--before` | Delete logs before this ISO timestamp |
| `--keep-days` | Keep logs from the last N days |
| `--yes` | Skip confirmation prompt |

### `relog mcp`

Start an MCP server for AI agent integration (see [MCP Server](#mcp-server) below).

```bash
relog mcp --url http://localhost:3485 --auth user:pass
```

## MCP Server

Relog includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI agents query your logs through natural tool use. The MCP server connects to a running relog HTTP server and exposes tools over stdio.

### Setup with Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "relog": {
      "command": "npx",
      "args": ["relog", "mcp", "--url", "http://localhost:3485"]
    }
  }
}
```

With auth:

```json
{
  "mcpServers": {
    "relog": {
      "command": "npx",
      "args": ["relog", "mcp", "--url", "http://localhost:3485", "--auth", "user:pass"]
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_logs` | Search and filter logs by level, service, project, branch, text, and time range |
| `query_logs` | Run read-only SQL against the logs table |
| `get_stats` | Server health, log counts by level, service breakdown, and project breakdown |
| `tail_logs` | Get the most recent logs |
| `get_log_context` | Get logs surrounding a specific log ID (before/after context) |

### Programmatic Use

```typescript
import { createMcpServer } from "relog/mcp";

const server = createMcpServer({
  url: "http://localhost:3485",
  auth: "user:pass",
});
```

### Using Without MCP

AI agents that can make HTTP calls can use the REST API directly:

- `GET /logs?level=error&from=1h&project=my-app` — search and filter logs
- `POST /query` with `{ "sql": "..." }` — run SQL queries
- `GET /health` — check server status

The MCP server is preferred when available since agents get typed tool schemas with descriptions automatically.

## Next.js Integration

Relog provides a drop-in integration for Next.js that captures console output, HTTP requests, and unhandled errors with just two files.

### Setup

**`instrumentation.ts`** (project root):

```typescript
import { withRelog } from "relog/next";

const relog = withRelog({
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
import { relogMiddleware } from "relog/next";
import { NextResponse } from "next/server";

export default relogMiddleware(() => NextResponse.next());
```

That's it. All `console.log/warn/error/info/debug` calls on the server are captured, every HTTP request is logged with method/path/status/duration, and unhandled errors in server components, server actions, and route handlers are tracked automatically.

### Explicit Structured Logging

Use the `log` export anywhere in server code for explicit structured logs:

```typescript
import { log } from "relog/next";

log.info("user signed in", { userId: "123" });
log.error(new Error("payment failed"), { orderId: "abc" });
```

### Wrapping Existing Middleware

Pass your middleware function to `relogMiddleware`. The trace ID header is automatically added to the response:

```typescript
import { relogMiddleware } from "relog/next";

function myMiddleware(request: Request) {
  // your logic
  return new Response(null, { status: 200 });
}

export default relogMiddleware(myMiddleware);
```

### Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `RELOG_URL` env or `http://localhost:3485` | Relog server URL |
| `service` | `string` | `"next"` | Service name |
| `auth` | `string` | `RELOG_AUTH` env | Basic auth credentials |
| `level` | `LogLevel` | `"info"` | Minimum log level |
| `captureConsole` | `boolean` | `true` | Patch console methods to capture output |
| `traceHeader` | `string` | `"x-trace-id"` | Response header name for trace IDs |
| `batchSize` | `number` | `50` | Logs per HTTP batch |
| `flushInterval` | `number` | `5000` | Auto-flush interval (ms) |

### How It Works

- **Console patching**: `register()` intercepts `console.log/info/warn/error/debug`, forwarding each call to both the terminal (original behavior preserved) and the relog transport. A recursion guard prevents infinite loops when the transport itself logs warnings.
- **Request logging**: The middleware logs every request with method, path, status code, duration, and a generated trace ID. The trace ID is also set as an `x-trace-id` response header.
- **Error tracking**: `onRequestError` is a Next.js instrumentation hook that catches unhandled errors from server components, server actions, and route handlers, logging them with full route context.
- **Edge runtime**: The middleware detects Edge runtime (`NEXT_RUNTIME === "edge"`) and sends logs directly via `fetch` instead of using the full Logger/Transport stack, avoiding Node.js API dependencies.

## HTTP API

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Send log records (single object or array) |
| `GET` | `/logs` | Search logs with query params |
| `GET` | `/stream` | SSE stream of new logs |
| `POST` | `/query` | Run read-only SQL |
| `POST` | `/query/stream` | Streaming SQL query results (NDJSON) |
| `POST` | `/prune` | Delete logs before timestamp |
| `GET` | `/health` | Server health |

All endpoints support Basic auth via `Authorization` header when `--auth` is configured.

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

| Field | Required | Description |
|---|---|---|
| `level` | yes | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `message` | yes | Log message string |
| `timestamp` | no | ISO 8601 timestamp (server time if omitted) |
| `meta` | no | Arbitrary metadata object |
| `service` | no | Service name |
| `host` | no | Hostname |
| `pid` | no | Process ID |
| `trace_id` | no | Trace ID for distributed tracing |
| `span_id` | no | Span ID for distributed tracing |
| `project` | no | Project name |
| `branch` | no | Git branch |

### `GET /logs`

Search and filter logs.

```bash
curl "http://localhost:3485/logs?level=error&from=1h&service=api&project=my-app&limit=50"
```

| Param | Description |
|-------|-------------|
| `level` | Filter by log level |
| `service` | Filter by service name |
| `project` | Filter by project |
| `branch` | Filter by branch |
| `grep` | Text search in messages |
| `from` | Start time — ISO 8601 or relative (`30s`, `5m`, `1h`, `7d`) |
| `to` | End time — ISO 8601 or relative |
| `limit` | Max results (default 100, max 10000) |
| `offset` | Pagination offset |

Returns `{ rows, total, limit, offset }`.

### `GET /stream`

SSE stream of new logs in real-time.

```bash
curl -N "http://localhost:3485/stream?level=error&project=my-app"
```

| Param | Description |
|-------|-------------|
| `level` | Filter by log level |
| `service` | Filter by service name |
| `trace_id` | Filter by trace ID |
| `project` | Filter by project |
| `branch` | Filter by branch |

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
  created_at INTEGER NOT NULL
);
```

Indexed on: `created_at`, `level`, `service`, `trace_id`, `project`, `branch`, `(level, created_at)`, `(service, created_at)`, `(project, branch, created_at)`.

## Programmatic Server

```typescript
import { startServer } from "relog";

const { server, db, streamManager, shutdown } = startServer({
  port: 3485,
  dbPath: "relog.db",
  auth: "admin:secret",
  cors: true,
});

// later
shutdown();
```

### `ServerConfig`

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | — | Port to listen on |
| `dbPath` | `string` | — | SQLite database file path |
| `auth` | `string` | — | Basic auth credentials (`user:pass`) |
| `cors` | `boolean \| string \| string[]` | — | CORS origin(s) or `true` for `*` |
| `maxBodySize` | `number` | `5242880` | Max request body size in bytes (5 MB) |
| `maxBatchSize` | `number` | `1000` | Max log entries per ingest request |
| `streamDebounceMs` | `number` | `50` | Debounce interval for SSE stream updates |

## Environment Variables

| Variable | Description |
|---|---|
| `RELOG_URL` | Default relog server URL for the Next.js integration |
| `RELOG_AUTH` | Default basic auth credentials (`user:pass`) for client, CLI, and server |
| `LOG_LEVEL` / `RELOG_LEVEL` | Default log level for the client SDK |
| `RELOG_PROJECT` | Override auto-detected project name |
| `RELOG_BRANCH` | Override auto-detected git branch |
| `NODE_ENV` | When set to `production`, console output is disabled by default |

## Development

```bash
git clone https://github.com/TimMikeladze/relog.git
cd relog
bun install
```

| Command | Description |
|---|---|
| `bun run build` | Build with bunup |
| `bun run dev` | Build in watch mode |
| `bun test` | Run tests |
| `bun test --watch` | Run tests in watch mode |
| `bun run lint` | Run oxlint |
| `bun run format` | Run oxfmt |
| `bun run type-check` | TypeScript type checking |
| `bun run release` | Bump version, commit, push, and tag |

## License

MIT
