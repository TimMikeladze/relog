# relog

A lightweight, self-hosted logging system for Bun. Ship structured logs from any application to a SQLite-backed server, then tail, search, query, and export them from the CLI or HTTP API.

## Key Features

- **Zero-dependency server** — single SQLite file, WAL mode, no Redis or external databases
- **Batching client SDK** — automatic batching, retries with exponential backoff, buffer overflow protection
- **Real-time streaming** — SSE-based log tailing with server-side filtering
- **Read-only SQL queries** — run arbitrary SELECT/EXPLAIN/PRAGMA against the log database
- **Distributed tracing** — first-class `trace_id` and `span_id` support
- **Child loggers** — inherit service, meta, and trace context from parent loggers
- **Basic auth** — optional timing-safe authentication on all endpoints
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
└─────────────────────┘
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode)
- **Database**: SQLite via `bun:sqlite` (WAL mode)
- **Build**: bunup
- **CLI framework**: @drizzle-team/brocli
- **Linting**: oxlint
- **Formatting**: oxfmt

## Install

```bash
bun add relog
```

The `relog` package includes the server, CLI, and client SDK. Import from the appropriate entrypoint:

```typescript
import { startServer } from "relog";          // server
import { createLogger } from "relog/client";  // client SDK
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

All commands accept `--url` (default `http://localhost:3485`) and `--auth` for basic auth.

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
relog tail --level error --service my-app
```

| Option | Description |
|---|---|
| `--level` | Filter by log level |
| `--service` | Filter by service name |

### `relog search`

Search logs with filters.

```bash
relog search --grep "timeout" --level error --from 1h --limit 50
```

| Option | Default | Description |
|---|---|---|
| `--grep` | — | Search message text |
| `--level` | — | Filter by log level |
| `--service` | — | Filter by service name |
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
relog export --output logs.csv --format csv --from 2025-01-01T00:00:00Z
```

| Option | Default | Description |
|---|---|---|
| `--output` | (required) | Output file path |
| `--format` | `json` | Export format: `json`, `csv`, or `ndjson` |
| `--from` | — | Start time (ISO 8601) |
| `--to` | — | End time (ISO 8601) |
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

## HTTP API

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Send log records (single object or array) |
| `GET` | `/logs` | Search logs with query params (`level`, `service`, `grep`, `from`, `to`, `limit`, `offset`) |
| `GET` | `/stream` | SSE stream of new logs (supports `level`, `service`, `trace_id` filters) |
| `POST` | `/query` | Run read-only SQL (`{ "sql": "SELECT ...", "params": [] }`) |
| `POST` | `/query/stream` | Streaming SQL query results (NDJSON) |
| `POST` | `/prune` | Delete logs before timestamp (`{ "before": <epoch_ms> }`) |
| `GET` | `/health` | Server health: `{ ok, uptime, db_size_bytes, log_count }` |

All endpoints support Basic auth via `Authorization` header when `--auth` is configured.

### Time Filters

The `from` and `to` parameters on `/logs` accept:
- ISO 8601 timestamps: `2025-01-01T00:00:00Z`
- Relative durations: `30s`, `5m`, `1h`, `7d`

## Environment Variables

| Variable | Description |
|---|---|
| `RELOG_AUTH` | Default basic auth credentials (`user:pass`) for client, CLI, and server |
| `LOG_LEVEL` / `RELOG_LEVEL` | Default log level for the client SDK |
| `NODE_ENV` | When set to `production`, console output is disabled by default |

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

## Database Schema

The server stores logs in a single `logs` table:

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
  created_at INTEGER NOT NULL
);
```

Indexed on: `created_at`, `level`, `service`, `trace_id`, `(level, created_at)`, `(service, created_at)`.

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
