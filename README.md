# relog

A lightweight, self-hosted logging system. Ship structured logs from any Node.js/Bun app to a SQLite-backed server, then tail, search, query, and export them from the CLI or HTTP API.

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Your Application  │         │         relog server              │
│                     │         │                                  │
│  ┌───────────────┐  │  HTTP   │  ┌────────┐    ┌─────────────┐  │
│  │  relog-client  │──┼────────┼─▶│ /ingest │───▶│             │  │
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

## Install

```bash
# server + CLI
bun add relog

# client SDK (for your app)
bun add relog-client
```

## Quick Start

Start the server:

```bash
relog serve
# listening on http://localhost:3485
```

Send logs from your app:

```typescript
import { createLogger } from "relog-client";

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
relog tail
```

## Client SDK

### `createLogger(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | Server URL. Omit for console-only logging |
| `service` | `string` | — | Service name attached to every log |
| `level` | `string` | `"info"` | Minimum level (`trace` `debug` `info` `warn` `error` `fatal`) |
| `auth` | `string` | `RELOG_AUTH` env | Basic auth credentials (`user:pass`) |
| `console` | `boolean` | `true` in dev | Print to stdout |
| `batchSize` | `number` | `50` | Logs per HTTP batch |
| `flushInterval` | `number` | `5000` | Auto-flush interval (ms) |
| `meta` | `object` | — | Default metadata merged into every log |

### Child loggers

```typescript
const reqLog = log.child({ requestId: "abc-123", traceId: "t-1" });
reqLog.info("handling request"); // inherits service + meta from parent
```

### Log levels

`trace` < `debug` < `info` < `warn` < `error` < `fatal`

Set via `level` option or `LOG_LEVEL` / `RELOG_LEVEL` env var.

## CLI

All commands accept `--url` (default `http://localhost:3485`) and `--auth` for basic auth.

### `relog serve`

Start the log server.

```bash
relog serve --port 3485 --db relog.db --auth admin:secret --cors true
```

### `relog tail`

Stream logs in real-time with optional filters.

```bash
relog tail --level error --service my-app
```

### `relog search`

Search logs with filters.

```bash
relog search --grep "timeout" --level error --from 1h --limit 50
```

### `relog query`

Run read-only SQL directly against the log database.

```bash
relog query --sql "SELECT level, COUNT(*) as count FROM logs GROUP BY level"
relog query --sql "SELECT * FROM logs WHERE service = 'api' ORDER BY id DESC LIMIT 10" --format json
```

Supports `--format table` (default), `json`, or `csv`.

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

Supports `json`, `csv`, and `ndjson` formats.

### `relog prune`

Delete old logs.

```bash
relog prune --keep-days 30
relog prune --before 2025-01-01T00:00:00Z --yes
```

## HTTP API

| Method | Path | Description |
|---|---|---|
| `POST` | `/ingest` | Send log records (array of log objects) |
| `GET` | `/logs` | Search logs with query params (`level`, `service`, `grep`, `from`, `to`, `limit`) |
| `GET` | `/stream` | SSE stream of new logs (supports `level`, `service` filters) |
| `POST` | `/query` | Run read-only SQL (`{ "sql": "SELECT ..." }`) |
| `POST` | `/query/stream` | Streaming SQL query results |
| `POST` | `/prune` | Delete logs before timestamp (`{ "before": <epoch_ms> }`) |
| `GET` | `/health` | Server health, uptime, log count, db size |

All endpoints support Basic auth via `Authorization` header when `--auth` is configured.

## Environment Variables

| Variable | Description |
|---|---|
| `RELOG_AUTH` | Default basic auth credentials (`user:pass`) for both client and CLI |
| `LOG_LEVEL` / `RELOG_LEVEL` | Default log level for the client SDK |

## Programmatic Server

```typescript
import { startServer } from "relog";

const { server, db, shutdown } = startServer({
  port: 3485,
  dbPath: "relog.db",
  auth: "admin:secret",
  cors: true,
});

// later
shutdown();
```

## License

MIT
