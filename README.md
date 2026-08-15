# relog.dev

A lightweight, self-hosted logging system for Bun. Ship structured logs from any application to a SQLite-backed server, then tail, search, query, and export them from the CLI or HTTP API. Includes an MCP server for AI agent integration.

## Key Features

- **Process wrapping** — prefix any command with `relog` to capture all its logs automatically, zero SDK integration needed
- **Zero-dependency server** — single SQLite file, WAL mode, no Redis or external databases
- **Batching client SDK** — automatic batching, retries with exponential backoff, buffer overflow protection
- **Wide events** — build one event per request with all context, emit at the end with auto-duration and level escalation
- **Tail sampling** — client-side sampling that always keeps errors and slow requests, drops the rest at a configurable rate
- **Real-time streaming** — SSE-based log tailing with server-side filtering
- **Read-only SQL queries** — run arbitrary SELECT/EXPLAIN/PRAGMA against the log database
- **Distributed tracing** — first-class `trace_id` and `span_id` support
- **OpenTelemetry (OTLP) ingest** — standards-compliant `/v1/traces` and `/v1/logs` endpoints accept OTLP/JSON from any OTel SDK or collector, with gzip and hex/base64 ID handling. Span kind, status, scope, and resource attributes surface in the UI
- **Project & branch tracking** — auto-detected from git, filterable across all endpoints
- **Deployment context** — first-class `version` and `deployment_id` fields for tracking releases
- **Child loggers** — inherit service, meta, and trace context from parent loggers
- **Role-based API keys** — three roles (ingest, read, admin) with hierarchical Bearer token auth; supports multiple keys per role for multi-app environments
- **Generic dashboards** — named dashboards of SQL-backed widgets with per-dashboard variables (`${site}`, `${namespace}`, `${tenant}` — whatever you declare), rendered as stats, lines, bars, tables, heatmaps and gauges
- **Web analytics** — cookieless, GDPR-friendly pageview and event analytics in the same database as your logs: a one-line `<script>` tag, server-side bot filtering and enrichment, pre-aggregated rollups, and SQL that can join traffic against errors
- **Browser logging** — client-side logger with batched proxy delivery, error capture, and session tracking
- **Next.js integration** — drop-in console capture, request logging, error tracking, and browser proxy
- **MCP server** — AI agents (Claude Code, Cursor, etc.) can query logs via Model Context Protocol
- **Export** — JSON, CSV, and NDJSON export formats
- **S3 archival** — archive old logs to S3/MinIO as Parquet files, then query both hot (SQLite) and cold (S3) data seamlessly via DuckDB
- **Auto-prune** — automatic database maintenance with configurable size and age limits; archives to S3 before deleting when configured
- **Aggregates** — saved log filters with CRUD API for dashboards and quick views
- **Standalone binary** — `bun run build:bin` produces one self-contained executable with the server, CLI, DuckDB engine and web UI embedded; cross-compiles to macOS, Linux and Windows
- **Docker & Fly.io** — production-ready Dockerfile and fly.toml for single-instance deployment with persistent SQLite volumes

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│   Your Application  │         │       relog.dev server             │
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
│  relog <command>     │  stdio   ┌──────────────────────────────┐
│                     │─────────▶│  Any Process                 │
│  Wraps any process, │  pipe    │  (bun, node, python, cargo…) │
│  captures stdout/   │◀─────────│                              │
│  stderr as logs     │          └──────────────────────────────┘
│   - auto level      │
│   - JSON-aware      │  HTTP
│   - passthrough     │────────▶  relog.dev server
└─────────────────────┘

┌─────────────────────┐
│   relog.dev CLI      │  HTTP
│                     │────────▶  relog.dev server
│  tail | search      │
│  query | export     │
│  stats | prune      │
│  mcp                │
└─────────────────────┘

                                ┌──────────────────────────────────┐
                                │     AI Agents (Claude, etc.)     │
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

For Python:

```bash
pip install relog
# or: uv add relog
```

The `relog.dev` package includes the server, CLI, and client SDK. Import from the appropriate entrypoint:

```typescript
import { startServer } from "relog.dev"; // server
import { createLogger } from "relog.dev/client"; // client SDK
import { createMcpServer } from "relog.dev/mcp"; // MCP server
import { createLogger } from "relog.dev/next"; // Next.js integration
import { log } from "relog.dev/browser"; // Browser client
```

## Standalone Binary

One command produces a single self-contained executable — no Bun, no Node, no
`node_modules` on the target machine:

```bash
bun run build:bin     # -> bin/relog
./bin/relog start
```

The binary carries everything: HTTP server, CLI, DuckDB query engine, and the
web UI. Copy it to a box and run it.

```bash
./bin/relog start                      # server + web UI on :3485
./bin/relog start --no-ui              # ingest/query API only
./bin/relog start --port 8080 --db /data/relog.db --no-open
./bin/relog tail --url http://logs.internal:3485
./bin/relog -- bun run server.ts       # wrap a process, ship its output
```

Every subcommand documented under [CLI](#cli) works from the binary.

### Build Options

```bash
bun run build:bin --target linux-x64   # cross-compile
bun run build:bin --all                # every supported target
bun run build:bin --skip-app           # reuse an existing app/dist
bun run build:bin --no-compress        # skip zstd (faster build, ~4x larger)
bun run build:bin --help
```

| Target         | Output                      |
| -------------- | --------------------------- |
| `darwin-arm64` | `bin/relog-darwin-arm64`    |
| `darwin-x64`   | `bin/relog-darwin-x64`      |
| `linux-x64`    | `bin/relog-linux-x64`       |
| `linux-arm64`  | `bin/relog-linux-arm64`     |
| `windows-x64`  | `bin/relog-windows-x64.exe` |

Building for the host platform also writes a `bin/relog` copy. Cross-compiling
downloads the target's DuckDB addon from npm (its `os`/`cpu` fields mean
`bun install` never fetches it) and caches it under `.build/`, so a Linux binary
can be built from macOS. Bun downloads the target runtime on the first
cross-build, which takes a minute.

### How It Works

Two things Bun's `--compile` will not embed on its own:

1. **DuckDB's native addon.** `@duckdb/node-bindings` requires one of eight
   platform packages behind a `switch`, and the bundler tries to resolve every
   branch. The addon also dlopens a sibling `libduckdb` through `@loader_path`,
   which Bun's own `.node` extraction leaves behind. `scripts/build-binary.ts`
   aliases the package to a generated shim that unpacks addon and library into
   the same directory, then requires the result.
2. **The web UI.** `app/dist` is a directory tree, so it is concatenated into a
   single zstd-compressed blob and unpacked on first use.

On first launch the binary unpacks its payload into `~/.relog/native/` and
`~/.relog/ui/`; later launches reuse them. Both directories are content-addressed
by build hash, so upgrading a binary never serves stale assets, and a partially
written file can never be loaded — every file lands via a temp name and a rename.

`start --no-ui` never asks for the UI path, so it never unpacks it.

### Size and Limits

Binaries are 90–120MB: roughly 60MB Bun runtime, 27MB compressed DuckDB library,
2MB compressed UI. `--no-compress` trades ~4x the size for a faster build.

Linux binaries link against glibc — Debian, Ubuntu, and Amazon Linux work;
Alpine/musl does not. The Windows target builds but is untested.

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

### Wrapping Any Command

The fastest way to capture logs — just prefix your existing command with `relog`:

```bash
# start the server in one terminal
bunx relog.dev start

# in another terminal, prefix your command with relog
relog bun run dev
relog python manage.py runserver
relog cargo run --release
relog ./start.sh
```

The output looks identical to running the command directly. Behind the scenes, every line of stdout/stderr is parsed, classified by log level, and shipped to the relog server as structured log records.

**How level detection works:**

| Source output                        | Detected level | Why                 |
| ------------------------------------ | -------------- | ------------------- |
| `[ERROR] build failed`               | error          | Bracketed pattern   |
| `ERROR: connection refused`          | error          | Delimited pattern   |
| `TypeError: Cannot read properties`  | error          | Error class name    |
| `{"level":50,"msg":"fail"}`          | error          | Pino numeric level  |
| `2024-01-15 12:00:00 WARN slow`      | warn           | Timestamp + keyword |
| `level=error msg="crash"`            | error          | Logfmt              |
| `Traceback (most recent call last):` | error          | Python traceback    |
| `panic: runtime error`               | error          | Go panic            |
| Plain text on stdout                 | info           | Default             |
| Plain text on stderr                 | warn           | stderr default      |

**Options go before the command:**

```bash
relog --service api --url http://logs:3485 bun run dev
relog --auth my-token python app.py
```

| Option      | Default                                      | Description                                |
| ----------- | -------------------------------------------- | ------------------------------------------ |
| `--url`     | `http://localhost:3485`                      | Server URL (also reads `RELOG_URL` env)    |
| `--service` | Inferred from `package.json` name or command | Service name for log records               |
| `--auth`    | —                                            | Bearer token (also reads `RELOG_AUTH` env) |

Service name is auto-detected from the nearest `package.json` `name` field, or falls back to the command name. Git project and branch are auto-detected as usual.

The wrapped process's exit code is forwarded — `relog bun test && echo "passed"` works correctly. Ctrl+C is forwarded to the child process.

### Using the SDK

Start the server:

```bash
bunx relog.dev start
# relog.dev server listening on http://localhost:3485
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

Or from Python:

```python
from relog import create_logger

log = create_logger(
    "http://localhost:3485",
    service="my-app",
    # project and branch are auto-detected from git
)

log.info("server started", {"port": 3000})
log.warn("slow query", {"duration_ms": 1200})
log.error(ValueError("connection failed"))

# flush before exit
log.flush()
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

## Python Client

The Python client mirrors the TypeScript SDK with Python conventions (snake_case, context managers, sync API).

### Install

```bash
pip install relog
# or: uv add relog
```

### Basic Usage

```python
from relog import create_logger

log = create_logger("http://localhost:3485", service="my-app")

log.info("server started", {"port": 3000})
log.warn("slow query", {"duration_ms": 1200})
log.error(ValueError("connection failed"))

log.flush()
log.destroy()
```

### Child Loggers

```python
req_log = log.child(trace_id="t-1", meta={"request_id": "abc-123"})
req_log.info("handling request")  # inherits service + meta from parent
```

### Wide Events

```python
with log.event("http.request") as ev:
    ev.request(method="GET", url="/api/users")
    result = handle_request()
    ev.set("row_count", len(result))
    ev.response(status=200)
# auto-emits with duration_ms on exit
```

Exceptions are captured automatically:

```python
with log.event("process_payment") as ev:
    ev.set("order_id", "abc")
    charge_card()  # if this raises, ev.error() is called automatically
```

### `create_logger()` Options

| Option              | Type    | Default      | Description                                                      |
| ------------------- | ------- | ------------ | ---------------------------------------------------------------- |
| `url`               | `str`   | —            | Server URL (first positional arg). Omit for console-only         |
| `service`           | `str`   | —            | Service name attached to every log                               |
| `level`             | `str`   | `"info"`     | Minimum level. Also reads `LOG_LEVEL` / `RELOG_LEVEL` env        |
| `auth`              | `str`   | `RELOG_AUTH` | API key sent as Bearer token                                     |
| `console`           | `bool`  | `True`       | Print colored output to stdout/stderr                            |
| `project`           | `str`   | auto (git)   | Project name. Also reads `RELOG_PROJECT` env                     |
| `branch`            | `str`   | auto (git)   | Git branch. Also reads `RELOG_BRANCH` env                        |
| `version`           | `str`   | —            | App version                                                      |
| `deployment_id`     | `str`   | —            | Deployment identifier                                            |
| `sample_rate`       | `float` | `1.0`        | Sample rate for events (0–1). Errors and slow events always kept |
| `slow_threshold_ms` | `float` | —            | Events slower than this (ms) are always kept                     |
| `batch_size`        | `int`   | `50`         | Logs per HTTP batch                                              |
| `flush_interval`    | `float` | `5.0`        | Auto-flush interval in seconds                                   |
| `max_buffer_size`   | `int`   | `10000`      | Max buffered logs before oldest are dropped                      |
| `meta`              | `dict`  | —            | Default metadata merged into every log                           |
| `trace_id`          | `str`   | —            | Trace ID attached to every log                                   |
| `span_id`           | `str`   | —            | Span ID attached to every log                                    |

## CLI

All commands accept `--url` (default `http://localhost:3485`) and `--auth` for Bearer token authentication (also reads `RELOG_AUTH` env).

### `relog <command>`

Wrap any command to automatically capture its logs. See [Wrapping Any Command](#wrapping-any-command) for full details.

```bash
# auto-detect: anything that isn't a known relog subcommand is wrapped
relog bun run dev
relog node server.js
relog python app.py

# explicit run subcommand (equivalent)
relog run -- bun run dev

# with relog options before the command
relog --service my-api --url http://logs:3485 bun run dev

# use -- to pass flags through to the child
relog --service svc -- node app.js --port 8080
```

Stdout lines default to `info`, stderr lines default to `warn`. Lines containing structural level indicators (`[ERROR]`, `ERROR:`, `TypeError:`, JSON with `level` field, logfmt `level=`, etc.) are automatically upgraded to the correct level.

Supports JSON structured logs from Pino, Bunyan, Winston, and any logger that outputs `{"level":"...","message":"..."}` or `{"level":30,"msg":"..."}` (numeric Pino levels). Also detects GCP Cloud Logging's `severity` field and logfmt `level=error` style.

### `relog.dev start`

Start the log server.

```bash
relog.dev start --port 3485 --admin-key mykey --cors true
```

| Option                       | Default             | Description                                                                                                   |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--port`                     | `3485`              | Port to listen on                                                                                             |
| `--db`                       | `~/.relog/relog.db` | SQLite database file path                                                                                     |
| `--ingest-key`               | —                   | API key(s) for ingest role, comma-separated. Also reads `RELOG_INGEST_KEY*` env vars                          |
| `--read-key`                 | —                   | API key(s) for read role, comma-separated. Also reads `RELOG_READ_KEY*` env vars                              |
| `--admin-key`                | —                   | API key(s) for admin role, comma-separated. Also reads `RELOG_ADMIN_KEY*` env vars                            |
| `--key-prefix-length`        | `6`                 | Number of API key characters stored per log for auditing (0 to disable)                                       |
| `--cors`                     | `false`             | Enable CORS headers                                                                                           |
| `--max-db-size`              | `500mb`             | Auto-prune when DB exceeds this size. Accepts `b`, `kb`, `mb`, `gb` suffixes or raw bytes                     |
| `--max-age-days`             | `30`                | Auto-prune logs older than N days                                                                             |
| `--prune-interval`           | `60`                | How often to check auto-prune thresholds, in seconds                                                          |
| `--no-prune`                 | `false`             | Disable automatic pruning entirely                                                                            |
| `--s3-endpoint`              | —                   | S3/MinIO endpoint for archiving and reading archived data                                                     |
| `--s3-bucket`                | —                   | S3 bucket name                                                                                                |
| `--s3-access-key`            | —                   | S3 access key ID                                                                                              |
| `--s3-secret-key`            | —                   | S3 secret access key                                                                                          |
| `--s3-prefix`                | `logs`              | S3 key prefix for archived Parquet files                                                                      |
| `--s3-region`                | `us-east-1`         | S3 region                                                                                                     |
| `--s3-url-style`             | `path`              | S3 URL style: `path` for MinIO/Tigris, `vhost` for AWS S3                                                     |
| `--no-ui`                    | `false`             | Disable serving the web UI                                                                                    |
| `--no-open`                  | `false`             | Serve the web UI but skip auto-opening it in the browser                                                      |
| `--data-dir`                 | `~/.relog`          | Directory for saved dashboards, widgets and aggregates. Set it when running more than one server on a machine |
| `--trust-proxy`              | `false`             | Trust `X-Forwarded-For` for client IP and geo. Only enable behind a known reverse proxy                       |
| `--analytics`                | `false`             | Enable [web analytics](#web-analytics): serves `/script.js`, accepts `/collect`, exposes `/analytics/*`       |
| `--analytics-sites`          | —                   | Comma-separated allowlist of site ids accepted by `/collect`. Strongly recommended                            |
| `--analytics-key`            | `false`             | Require an ingest API key on `/collect` (server-side collection only)                                         |
| `--analytics-bots`           | `false`             | Count known bots and crawlers as visitors                                                                     |
| `--analytics-dnt`            | `false`             | Drop events from clients sending `DNT: 1`                                                                     |
| `--analytics-no-raw`         | `false`             | Store only rollups, not raw events. Cheaper, but loses per-dimension unique visitors                          |
| `--analytics-raw-days`       | `90`                | Days to keep raw analytics events                                                                             |
| `--analytics-aggregate-days` | `730`               | Days to keep analytics rollups, sessions, and visitor hours                                                   |
| `--analytics-rpm`            | `600`               | Per-IP `/collect` requests per minute                                                                         |

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

| Option       | Description            |
| ------------ | ---------------------- |
| `--level`    | Filter by log level    |
| `--service`  | Filter by service name |
| `--project`  | Filter by project      |
| `--branch`   | Filter by branch       |
| `--trace-id` | Filter by trace ID     |

### `relog.dev search`

Search logs with filters.

```bash
relog.dev search --grep "timeout" --level error --from 1h --project my-app --branch main --limit 50
```

| Option       | Default | Description                                                |
| ------------ | ------- | ---------------------------------------------------------- |
| `--grep`     | —       | Search message text                                        |
| `--level`    | —       | Filter by log level                                        |
| `--service`  | —       | Filter by service name                                     |
| `--project`  | —       | Filter by project                                          |
| `--branch`   | —       | Filter by branch                                           |
| `--trace-id` | —       | Filter by trace ID                                         |
| `--span-id`  | —       | Filter by span ID                                          |
| `--from`     | —       | Start time (ISO 8601 or relative: `30s`, `5m`, `1h`, `7d`) |
| `--to`       | —       | End time (ISO 8601)                                        |
| `--limit`    | `100`   | Max results to return                                      |

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

| Option       | Default    | Description                               |
| ------------ | ---------- | ----------------------------------------- |
| `--output`   | (required) | Output file path                          |
| `--format`   | `json`     | Export format: `json`, `csv`, or `ndjson` |
| `--from`     | —          | Start time (ISO 8601)                     |
| `--to`       | —          | End time (ISO 8601)                       |
| `--project`  | —          | Filter by project                         |
| `--branch`   | —          | Filter by branch                          |
| `--trace-id` | —          | Filter by trace ID                        |
| `--span-id`  | —          | Filter by span ID                         |
| `--limit`    | `10000`    | Max logs to export                        |

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
| `url`            | `string`   | `RELOG_URL` env or `http://localhost:3485` | relog.dev server URL                    |
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

- **Console patching**: `register()` intercepts `console.log/info/warn/error/debug/trace`, forwarding each call to both the terminal (original behavior preserved) and the relog.dev transport. A recursion guard prevents infinite loops when the transport itself logs warnings. Display-only helpers (`console.group/table/dir`) are intentionally not patched — they don't carry log payloads.
- **Request logging**: The middleware logs every request with method, path, status code, duration, and a generated trace ID. The trace ID is also set as an `x-trace-id` response header.
- **Error tracking**: `onRequestError` is a Next.js instrumentation hook that catches unhandled errors from server components, server actions, and route handlers, logging them with full route context.
- **Edge runtime**: The middleware detects Edge runtime (`NEXT_RUNTIME === "edge"`) and sends logs directly via `fetch` instead of using the full Logger/Transport stack, avoiding Node.js API dependencies. If the edge fetch fails (misconfigured `RELOG_URL`, network down), the failure is surfaced via `console.warn` once-per-process so logs aren't silently dropped forever.

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
	maxBodyBytes: 1 * 1024 * 1024, // 1 MiB cap; oversized requests get 413
});
```

The proxy rejects requests whose `Content-Length` (or actual streamed length) exceeds `maxBodyBytes` _before_ parsing JSON, so a hostile client can't OOM your Next.js process by posting a giant blob. Per-IP rate limiting is left to your existing middleware.

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

## OpenTelemetry (OTLP)

relog.dev speaks [OTLP/HTTP](https://opentelemetry.io/docs/specs/otlp/#otlphttp) with JSON encoding, so any OpenTelemetry SDK or the OpenTelemetry Collector can export traces and logs to it without relog-specific code. Spans, span events, resource attributes, span kind, and status codes are all preserved and surfaced in the UI's Traces view.

### Endpoints

| Endpoint           | What it accepts                                                     |
| ------------------ | ------------------------------------------------------------------- |
| `POST /v1/traces`  | OTLP/JSON `ExportTraceServiceRequest` — `resourceSpans[]`           |
| `POST /v1/logs`    | OTLP/JSON `ExportLogsServiceRequest` — `resourceLogs[]`             |
| `POST /v1/metrics` | Returns `501 Not Implemented` — metrics ingest is not yet supported |

Both endpoints require the `ingest` role (Bearer token) when API keys are configured. Responses follow the OTLP spec shape: `200 {"partialSuccess":{}}` on success, `415` for unsupported content types, `400` for malformed payloads.

### What's supported

- **Content type:** `application/json` (proto3 JSON encoding). `application/x-protobuf` returns 415 — use the HTTP/JSON protocol on the exporter side.
- **Compression:** `Content-Encoding: gzip` on request bodies (per the OTLP/HTTP spec).
- **Trace / span IDs:** Both hex strings and base64 (the proto3 JSON canonical form) are accepted and normalized to lowercase hex on write, so IDs are consistent regardless of which SDK you use.
- **Spans → logs mapping:** Each span becomes one log entry — `message` = span name, `duration_ms` = span duration, `level` = `error` when `status.code = 2`, otherwise `info`. All span attributes land in `meta` alongside `span_kind`, `span_status_code`, `span_status_message`, and `instrumentation_scope`.
- **Span events:** Each span event becomes its own log entry linked to the same `trace_id` + `span_id`, with `meta.otel_event = true`. Events named `exception` are auto-escalated to `error` level with the exception message.
- **Resource attributes:** `service.name` and `host.name` map to the first-class `service` and `host` columns; all resource attributes (including `service.version`, `deployment.environment`, etc.) are preserved under `meta.resource`.
- **Severity mapping (logs):** OTel `severityNumber` is mapped to relog levels — 1-4 → `trace`, 5-8 → `debug`, 9-12 → `info`, 13-16 → `warn`, 17-20 → `error`, 21+ → `fatal`.

### Point any OTel exporter at relog

Works with the standard `OTEL_EXPORTER_OTLP_*` env vars — no relog-specific client code required:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3485
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer my-ingest-key"
```

The Traces view groups records by `trace_id`, rebuilds the parent/child hierarchy, and shows a waterfall with span kind badges (SRV/CLI/PRD/CNS/INT) and error markers. The span detail panel surfaces span attributes, resource attributes, status, and instrumentation scope.

### Example

A runnable example lives in [`examples/otel/`](examples/otel/):

- `otel-raw.ts` — zero-dependency OTLP/JSON over `fetch` (shows the wire format)
- `otel-sdk.ts` — realistic path using `@opentelemetry/sdk-node` + OTLP/HTTP exporter

```bash
# terminal 1
bunx relog.dev start

# terminal 2
bun examples/otel/otel-raw.ts
```

### Python client

The Python client (`pip install relog.dev`) can emit the same OTel-shaped metadata through `EventBuilder`:

```python
from relog import create_logger, SpanKind, SpanStatusCode

log = create_logger("http://localhost:3485", service="api")

with log.event("http_request") as ev:
    ev.kind(SpanKind.SERVER).scope("relog.http", "1.0.0").resource({
        "service.name": "api",
        "deployment.environment": "production",
    })
    # ...do work...
    ev.status(SpanStatusCode.OK)
```

`ev.error(exc)` automatically sets `span_status_code=2` when any OTel field is present.

## Dashboards

The web UI's Dashboard tab is a generic, SQL-backed dashboard system. A dashboard is a named set of widgets plus the **variables** viewers can change across all of them at once. Two ship built in — **Logs** and **Web Analytics** — and neither is special-cased: both are ordinary dashboards defined as data.

A widget is a SQL query and a chart kind (`stat`, `line`, `bar`, `table`, `status-grid`, `heatmap`, `gauge`, `sparkline`). Its SQL can reference `${from}` and `${to}`, which the time-range picker always supplies, plus any variable its dashboard declares.

### Variables

Variables are what keep this generic. Before them, the only filters were `service` and `project` — hardcoded, because logs happen to have those columns. A dashboard over analytics wants `site`; one over a Kubernetes cluster wants `namespace`; one over a multi-tenant app wants `tenant`. Declaring them per dashboard means none of that is known in advance:

```json
{
	"id": "ops",
	"name": "Ops",
	"defaultTimeRange": "6h",
	"variables": [
		{
			"name": "namespace",
			"label": "Namespace",
			"type": "select",
			"optionsSql": "SELECT DISTINCT json_extract(meta, '$.namespace') AS value FROM logs",
			"includeAll": true
		},
		{ "name": "threshold", "label": "Slower than (ms)", "type": "number", "default": 500 }
	]
}
```

Each becomes a control in the toolbar and a `${name}` placeholder in that dashboard's widget SQL:

```sql
SELECT COUNT(*) AS value
FROM logs
WHERE created_at BETWEEN ${from} AND ${to}
  AND (${namespace} IS NULL OR json_extract(meta, '$.namespace') = ${namespace})
  AND (${threshold} IS NULL OR duration_ms > ${threshold})
```

The `(${var} IS NULL OR col = ${var})` idiom is the convention throughout: an unset variable means "all", with no second query and no branching in the client.

| Field        | Meaning                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`       | Placeholder name. Must match `[a-zA-Z_][a-zA-Z0-9_]*`; `from` and `to` are reserved                                          |
| `type`       | `select`, `text`, or `number`                                                                                                |
| `options`    | Fixed choices for a `select`                                                                                                 |
| `optionsSql` | SQL producing a `value` column, optionally a `label` column — lets a variable enumerate whatever is actually in the database |
| `default`    | Initial value; omit to start on "All"                                                                                        |
| `includeAll` | Offer an "All" choice that substitutes NULL. Default: true                                                                   |

Substitution is typed and always safe: `number` variables become bare numeric literals (a non-numeric value reads as unset), everything else becomes a single-quoted string with embedded quotes doubled. There is no path by which a variable value becomes SQL syntax. A placeholder the dashboard does not declare is an error rather than a silent NULL — otherwise a typo would quietly widen a widget's scope and show plausible numbers for the wrong thing.

### Dashboards HTTP API

| Method   | Path              | Role  | Description                             |
| -------- | ----------------- | ----- | --------------------------------------- |
| `GET`    | `/dashboards`     | read  | List dashboards                         |
| `GET`    | `/dashboards/:id` | read  | One dashboard together with its widgets |
| `POST`   | `/dashboards`     | admin | Create a dashboard                      |
| `PUT`    | `/dashboards/:id` | admin | Update a dashboard                      |
| `DELETE` | `/dashboards/:id` | admin | Delete a dashboard and its widgets      |

Widgets belong to a dashboard via `dashboardId`; a widget without one shows on the default `logs` dashboard, so widgets created before dashboards existed stay where their author left them. Built-in dashboards and widgets cannot be modified or deleted — only hidden, or duplicated and then edited.

Dashboards, widgets, and aggregates persist as JSON under `~/.relog`. Point a server at its own copy with `--data-dir` when running more than one on a machine; otherwise they share and overwrite each other's saved dashboards.

## Web Analytics

relog can double as a self-hosted, cookieless web-analytics service — the Umami/Plausible shape — reusing the same SQLite file, auth, retention, SQL endpoint, and MCP server as the logs.

Enable it explicitly:

```bash
relog.dev start --analytics --analytics-sites my-site,docs
```

Then drop one tag on the pages you want to measure:

```html
<script defer src="http://localhost:3485/script.js" data-site="my-site"></script>
```

That's the whole integration. Pageviews, SPA route changes, referrers, UTMs, and time-on-page are tracked automatically.

### Custom events

```js
relog("signup", { plan: "pro" });
relog("purchase", { plan: "pro", revenue: 49 });
```

Or declaratively, with no JavaScript of your own:

```html
<button data-relog-event="signup" data-relog-plan="pro">Start free trial</button>
```

To capture calls that fire before the script has loaded, add the standard stub before it:

```html
<script>
	window.relog =
		window.relog ||
		function () {
			(window.relog.q = window.relog.q || []).push(arguments);
		};
</script>
```

### Script tag options

| Attribute             | Default             | Description                                              |
| --------------------- | ------------------- | -------------------------------------------------------- |
| `data-site`           | — (required)        | Site id. Must be in `--analytics-sites` when that is set |
| `data-host`           | script's own origin | Origin to send events to                                 |
| `data-auto`           | `true`              | Track pageviews automatically; `false` for manual only   |
| `data-exclude-search` | `false`             | Drop query strings from stored paths (UTMs still parsed) |
| `data-domains`        | —                   | Comma-separated hostnames allowed to report              |

### How visitors are counted

There is no cookie and no stored IP address. Each event's visitor id is derived server-side as `sha256(daily_salt + site + ip + user_agent)`, truncated to 128 bits. The salt is random per UTC day and old salts are deleted, so once a day rolls over nobody — including whoever holds the database — can map a known IP back to historical rows.

The trade-offs are the standard ones for this approach: a visitor is counted fresh each UTC day, and two people behind the same NAT on the same browser collapse into one. The numbers are comparative, not forensic.

Everything else the client sends is treated as untrusted. Country, browser, OS, and device are derived server-side from the request; a supplied `visitor_id` is ignored; client timestamps far from now are replaced with server time; custom props are capped and run through the same secret redaction as log ingest.

Country/region/city come from your edge proxy's headers (Cloudflare, Vercel, CloudFront, Fly) and are only read when `--trust-proxy` is set — otherwise any client could forge its own location.

### Storage model

Three aggregate tables are written synchronously with every event, so dashboards never wait on a background job and never disagree with the raw data:

| Table           | Grain                                       | Backs                                            |
| --------------- | ------------------------------------------- | ------------------------------------------------ |
| `event_rollups` | hour × path × referrer × UTM × geo × device | views, revenue, time-on-page                     |
| `visitor_hours` | one row per (site, hour, visitor)           | unique visitors (counts, never sums, per bucket) |
| `sessions`      | one row per session                         | bounce rate, session duration, entry/exit pages  |
| `events`        | raw event stream                            | per-dimension uniques, realtime, ad-hoc SQL      |

Paths are normalized at ingest (`/orders/8123` → `/orders/:id`) so dimension cardinality stays bounded — without it the rollup table degenerates into one row per pageview.

Raw events are prunable independently of the aggregates (`--analytics-raw-days`, default 90; `--analytics-aggregate-days`, default 730). With `--analytics-no-raw`, only rollups are stored: dashboards keep working at a fraction of the storage, at the cost of per-dimension unique visitors and the realtime page list. When a query range predates raw retention, breakdowns report views from the rollups and `visitors: null` rather than a wrong number.

### Analytics HTTP API

| Method | Path                    | Role       | Description                                         |
| ------ | ----------------------- | ---------- | --------------------------------------------------- |
| `GET`  | `/script.js`            | —          | The tracker. Public, cached, CORS `*`               |
| `POST` | `/collect`              | — / ingest | Receive events. Public unless `--analytics-key`     |
| `GET`  | `/analytics/overview`   | read       | Views, visitors, sessions, bounce rate, duration    |
| `GET`  | `/analytics/timeseries` | read       | Bucketed views/visitors/sessions (`unit=hour\|day`) |
| `GET`  | `/analytics/breakdown`  | read       | Top values for a dimension (`dimension=path`, …)    |
| `GET`  | `/analytics/realtime`   | read       | Active sessions and pages in the last N minutes     |
| `GET`  | `/analytics/events`     | read       | Custom event names with counts                      |
| `GET`  | `/analytics/sites`      | read       | Sites seen, most recently active first              |
| `GET`  | `/analytics/stats`      | read       | Row counts across the analytics tables              |

Read endpoints accept either `period=24h|7d|30d|12mo` or absolute `from`/`to` epoch milliseconds. `dimension` is one of `name`, `path`, `referrer_host`, `utm_source`, `utm_medium`, `utm_campaign`, `country`, `device`, `browser`, `os`.

```bash
curl "http://localhost:3485/analytics/overview?site=my-site&period=7d"
curl "http://localhost:3485/analytics/breakdown?site=my-site&period=30d&dimension=referrer_host"
```

`/collect` and `/script.js` answer cross-origin regardless of the `--cors` setting — the tracker runs on other people's pages. `/collect` is rate-limited per remote address (`--analytics-rpm`, default 600) and, when `--trust-proxy` is off, buckets by socket address so the header cannot be forged.

`/analytics/*` sits behind the `read` role like the rest of the read API. `/collect` is open by default because a key embedded in a public tracker script is not a secret; use `--analytics-sites` to bound what can be written. `--analytics-key` requires an ingest key and is meant for server-side or first-party-proxied collection.

### Joining traffic against errors

The analytics tables are exposed to `/query`, the CLI, and the MCP server as ordinary SQL views — which is the point of keeping them in the same database:

```sql
SELECT
  strftime(to_timestamp(r.bucket / 1000), '%Y-%m-%d %H:00') AS hour,
  SUM(r.views) AS views,
  (SELECT COUNT(*) FROM logs l
    WHERE l.level = 'error' AND l.created_at >= r.bucket AND l.created_at < r.bucket + 3600000
  ) AS errors
FROM event_rollups r
WHERE r.site = 'my-site' AND r.name = 'pageview'
GROUP BY r.bucket
ORDER BY r.bucket DESC
```

An agent with the MCP server attached can ask "why did signups drop Tuesday" and get both the funnel numbers and the errors behind them.

### Bots and Do Not Track

Known crawlers, headless browsers, HTTP clients, link-preview fetchers, and AI scrapers are dropped before anything is written; pass `--analytics-bots` to count them. Bot requests get `202`, not an error, so they don't retry. `--analytics-dnt` additionally drops events from clients sending `DNT: 1`.

### Programmatic use

```typescript
import { RelogDatabase } from "relog.dev";

const db = new RelogDatabase("./relog.db");
const range = { site: "my-site", from: Date.now() - 7 * 86_400_000, to: Date.now() };

db.analytics.overview(range);
db.analytics.timeseries(range, "day");
db.analytics.breakdown(range, "referrer_host", 10);
db.analytics.realtime("my-site");
```

## HTTP API

| Method   | Path              | Role   | Description                                            |
| -------- | ----------------- | ------ | ------------------------------------------------------ |
| `POST`   | `/ingest`         | ingest | Send log records (single object or array)              |
| `POST`   | `/v1/traces`      | ingest | OTLP/JSON traces (OpenTelemetry)                       |
| `POST`   | `/v1/logs`        | ingest | OTLP/JSON logs (OpenTelemetry)                         |
| `GET`    | `/logs`           | read   | Search logs with query params                          |
| `GET`    | `/traces`         | read   | List traces grouped by `trace_id`                      |
| `GET`    | `/stream`         | read   | SSE stream of new logs                                 |
| `POST`   | `/query`          | read   | Run read-only SQL                                      |
| `POST`   | `/query/stream`   | read   | Streaming SQL query results (NDJSON)                   |
| `POST`   | `/histogram`      | read   | Time-bucketed log counts                               |
| `POST`   | `/prune`          | admin  | Delete logs before timestamp                           |
| `GET`    | `/aggregates`     | read   | List saved aggregates                                  |
| `GET`    | `/aggregates/:id` | read   | Get a single aggregate                                 |
| `POST`   | `/aggregates`     | admin  | Create a saved aggregate                               |
| `PUT`    | `/aggregates/:id` | admin  | Update a saved aggregate                               |
| `DELETE` | `/aggregates/:id` | admin  | Delete a saved aggregate                               |
| `GET`    | `/health`         | —      | Server health (no auth required)                       |
| `POST`   | `/collect`        | —      | Analytics events (see [Web Analytics](#web-analytics)) |
| `GET`    | `/script.js`      | —      | Analytics tracker script                               |
| `GET`    | `/analytics/*`    | read   | Analytics read API                                     |
| `GET`    | `/dashboards`     | read   | List dashboards (see [Dashboards](#dashboards))        |
| `GET`    | `/dashboards/:id` | read   | A dashboard together with its widgets                  |
| `POST`   | `/dashboards`     | admin  | Create a dashboard                                     |
| `PUT`    | `/dashboards/:id` | admin  | Update a dashboard                                     |
| `DELETE` | `/dashboards/:id` | admin  | Delete a dashboard and its widgets                     |

All endpoints (except `/health`) require a Bearer token via `Authorization: Bearer <key>` when API keys are configured. Routes are protected by role: `ingest` for `/ingest`, `read` for `/logs`, `/query`, `/query/stream`, `/stream`, `/histogram`, and `admin` for `/prune` and write operations on `/aggregates`.

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

**Idempotency:** pass an `Idempotency-Key` (or `X-Idempotency-Key`) header to dedupe automatic client retries. The cached response is replayed for the configured TTL with an `Idempotent-Replay: true` response header. The cache is per-route and per-key-prefix, LRU-evicted under load so a still-active key isn't dropped under burst traffic.

**Rate limit:** ingest is rate-limited per API key prefix (default 600 req/min/key, configurable via `--ingest-rpm`). One noisy key cannot starve other keys.

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
| `trace_id`      | Filter by trace ID                                          |
| `span_id`       | Filter by span ID                                           |
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

Heartbeats every 25s (under the common 30s proxy idle-timeout). A slow consumer that lets >1000 messages queue is dropped and the stream is closed — clients should reconnect with backoff.

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

### `POST /histogram`

Get time-bucketed log counts for charting. The bucket count adapts to the time range if not specified.

```bash
curl -X POST http://localhost:3485/histogram \
  -H "Content-Type: application/json" \
  -d '{ "from": 1700000000000, "to": 1700086400000, "filters": { "level": "error" } }'
```

| Field                   | Required | Description                                          |
| ----------------------- | -------- | ---------------------------------------------------- |
| `from`                  | yes      | Start time (epoch ms)                                |
| `to`                    | yes      | End time (epoch ms)                                  |
| `buckets`               | no       | Number of time buckets (1–1000, auto if omitted)     |
| `filters.level`         | no       | Filter by log level (comma-separated for `IN` match) |
| `filters.service`       | no       | Filter by service                                    |
| `filters.project`       | no       | Filter by project                                    |
| `filters.branch`        | no       | Filter by branch                                     |
| `filters.version`       | no       | Filter by version                                    |
| `filters.deployment_id` | no       | Filter by deployment ID                              |
| `filters.trace_id`      | no       | Filter by trace ID                                   |
| `filters.span_id`       | no       | Filter by span ID                                    |

### `POST /prune`

Delete logs before a timestamp (epoch milliseconds).

```json
{ "before": 1700000000000 }
```

### Aggregates API

Saved log filters for dashboards and quick views. Stored as JSON on disk.

**Create:**

```bash
curl -X POST http://localhost:3485/aggregates \
  -H "Content-Type: application/json" \
  -d '{
    "id": "prod-errors",
    "name": "Production Errors",
    "filters": { "level": "error", "project": "my-app", "branch": "main" },
    "icon": "🔴"
  }'
```

**List all:** `GET /aggregates` → `{ aggregates: [...] }`

**Get one:** `GET /aggregates/prod-errors` → `{ aggregate: {...} }`

**Update:** `PUT /aggregates/prod-errors` with partial body

**Delete:** `DELETE /aggregates/prod-errors`

### `GET /health`

Returns `{ ok, uptime, db_size_bytes, log_count }`. When auto-prune is configured, also includes `auto_prune: { max_db_size, max_age_days, interval_seconds, db_usage_pct }`.

Unauthenticated. Per-IP rate-limited at 60 req/min — single misbehaving probe can't starve real load-balancer probes. The remote IP comes from the first `X-Forwarded-For` entry when present, otherwise the socket peer; front the server with a reverse proxy that sets `X-Forwarded-For` in production.

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
| `autoPrune`        | `AutoPruneConfig`               | —         | Auto-prune configuration (see below)                |
| `archive`          | `ArchiveConfig`                 | —         | S3 archive configuration (see below)                |
| `uiDistPath`       | `string`                        | —         | Path to web UI dist folder                          |

## Auto-Prune & Archival

Auto-prune is **enabled by default** to prevent SQLite from growing unbounded. Out of the box, the server prunes logs older than 30 days and keeps the database under 500MB. When S3 is configured, logs are **archived to S3 as Parquet files before being deleted** from SQLite — no data is lost. When S3 is not configured, pruned logs are permanently deleted.

Pass `--no-prune` to disable automatic pruning entirely.

### How It Works

```
┌──────────────────────────────────────────────────────────────────┐
│                     Auto-Prune Cycle                             │
│                  (runs every --prune-interval)                   │
│                                                                  │
│  1. Age-based prune (if --max-age-days set):                     │
│     └─ Find logs older than N days                               │
│        ├─ S3 configured → archive to Parquet, then delete        │
│        └─ No S3 → delete directly                                │
│                                                                  │
│  2. Size-based prune (if --max-db-size set):                     │
│     └─ While DB size > threshold:                                │
│        ├─ Fetch oldest 5000 logs                                 │
│        ├─ S3 configured → archive to Parquet, then delete        │
│        ├─ No S3 → delete directly                                │
│        └─ Stall detection: stop if DB size didn't shrink         │
│                                                                  │
│  3. If anything was archived to S3:                               │
│     └─ Refresh DuckDB view so queries see new Parquet files      │
└──────────────────────────────────────────────────────────────────┘
```

### Defaults

A plain `relog.dev start` automatically prunes with these defaults:

| Threshold          | Default | Description                              |
| ------------------ | ------- | ---------------------------------------- |
| `--max-db-size`    | `500mb` | Delete oldest logs when DB exceeds 500MB |
| `--max-age-days`   | `30`    | Delete logs older than 30 days           |
| `--prune-interval` | `60`    | Check thresholds every 60 seconds        |

### Examples

```bash
# Default pruning — just start the server, no flags needed
relog.dev start

# Customize thresholds
relog.dev start --max-db-size 2gb --max-age-days 90

# Disable pruning entirely
relog.dev start --no-prune

# Archive to S3 before pruning — no data loss
relog.dev start \
  --s3-endpoint https://s3.amazonaws.com \
  --s3-bucket my-logs-bucket \
  --s3-access-key AKIA... \
  --s3-secret-key secret...

# MinIO / Tigris (path-style URLs)
relog.dev start \
  --max-age-days 7 \
  --s3-endpoint http://minio:9000 \
  --s3-bucket logs \
  --s3-access-key minioadmin \
  --s3-secret-key minioadmin \
  --s3-url-style path
```

### Hot + Cold Storage

When S3 is configured, relog.dev uses a **hot/cold storage architecture**:

- **Hot**: Recent logs live in SQLite for fast writes and real-time streaming
- **Cold**: Archived logs live in S3 as compressed Parquet files (Snappy codec)
- **Unified queries**: DuckDB creates a UNION ALL view across both, so `/logs`, `/query`, and `/histogram` transparently query all data

Parquet files are partitioned by `project/branch/year/month/day` for efficient range scans.

### Retry Behavior

S3 uploads use exponential backoff with jitter: `baseDelay * 2^attempt + random * baseDelay`, capped at `maxDelay`. The default retry config is 3 retries with 1–30s delays. If all retries fail for a partition, those logs stay in SQLite and will be retried on the next prune cycle.

### Cycle Budget

Each prune cycle (age- and size-based) is capped at a 30-second wall-clock budget. With a huge backlog after a long outage, a single cycle could otherwise run for many minutes; the in-flight guard prevents overlapping ticks but a stuck cycle would silently halt all future pruning. Pass a custom budget via `pruneByAge(..., budgetMs)` / `pruneBySize(..., budgetMs)` if you call them programmatically. The cycle exits early with a warn line and the next interval picks up where it left off.

### Schema (Parquet)

Archived Parquet files use INT64 for `id`, `pid`, and `created_at` so SQLite ROWIDs above 2³¹ never silently wrap into negative values on long-running instances.

## Deploy

### Docker

```bash
docker build -t relog .
docker run -p 3485:3485 -v relog_data:/data relog
```

The server stores its SQLite database at `/data/relog.db` inside the container. Mount a volume to `/data` for persistence.

Set API keys via environment variables:

```bash
docker run -p 3485:3485 -v relog_data:/data \
  -e RELOG_ADMIN_KEY=your-secret-key \
  relog
```

### Fly.io

The included `fly.toml` is configured for a single-instance deployment with a persistent volume for SQLite.

```bash
# First time setup
fly launch --no-deploy

# Set API keys as secrets
fly secrets set RELOG_ADMIN_KEY=your-secret-key

# Deploy
fly deploy
```

The default configuration:

| Setting      | Value               | Description                                  |
| ------------ | ------------------- | -------------------------------------------- |
| VM           | `shared-cpu-1x`     | Shared CPU with 1GB memory                   |
| Volume       | `1gb`               | Auto-created at `/data` on first deploy      |
| Health check | `/health` every 30s | Excluded from auth                           |
| Auto-stop    | `stop`              | Scales to zero when idle; a request wakes it |
| Auto-prune   | `500mb` / `30d`     | Default size and age limits                  |

Scale-to-zero is safe because the SQLite file lives on the volume — a stop/start
cycle keeps all data. Raise `min_machines_running` to 1 if you want to avoid
cold-start latency on the first request after an idle period.

To archive to S3 before pruning (Tigris is Fly.io's native S3-compatible storage):

```bash
fly secrets set \
  RELOG_ADMIN_KEY=your-secret-key

fly deploy -- \
  --s3-endpoint https://fly.storage.tigris.dev \
  --s3-bucket my-logs \
  --s3-access-key $TIGRIS_ACCESS_KEY \
  --s3-secret-key $TIGRIS_SECRET_KEY
```

## Distributed Deployment

relog has no shared write path — a server owns its SQLite file and is the only
process allowed to touch it. Running more than one node therefore means choosing
a topology, not setting a flag.

### What Is Shared, What Is Node-Local

The **S3 archive is safe for many writers**. Object keys are
`prefix/project=…/branch=…/year=…/month=…/day=…/<timestamp>-<uuid>.parquet`, so
concurrent archivers never collide, and every node that holds the bucket
credentials reads the whole history through the DuckDB union view.

Everything else belongs to one node:

| State                                | Scope                                               |
| ------------------------------------ | --------------------------------------------------- |
| Hot logs (SQLite)                    | Node-local. Never share the file between processes. |
| `/stream` SSE subscribers            | Node-local — polls that node's database.            |
| Dashboards, widgets, aggregates JSON | Node-local, under `--data-dir`.                     |
| Auto-prune and archive loop          | Node-local.                                         |
| Archived Parquet in S3               | **Shared.** Multi-writer safe, read by all.         |

### Topology 1 — Central Server, Distributed Collection

The default. One server; a binary on every host ships to it. Scales until a
single machine can no longer absorb the ingest rate, which is a long way off.

```bash
# central
relog start --db /data/relog.db --ingest-key "$KEY"

# every app host — no local storage, logs stream to the central server
RELOG_URL=https://logs.internal:3485 RELOG_AUTH=$KEY relog -- bun run server.ts
```

### Topology 2 — Writer Plus Stateless Read Replicas

The writer holds a short hot window and pushes everything else to S3. Replicas
serve the UI and queries from the Parquet lake, need no volume, and can run in
any region.

```bash
# writer: keep ~1h hot, archive the rest
relog start --db /data/relog.db --max-age-days 0.04 --max-db-size 200mb \
  --s3-endpoint https://fly.storage.tigris.dev --s3-bucket relog-archive \
  --s3-access-key $K --s3-secret-key $S --s3-url-style path

# replica: throwaway local db, same bucket, no volume
relog start --db /tmp/replica.db --no-prune \
  --s3-endpoint https://fly.storage.tigris.dev --s3-bucket relog-archive \
  --s3-access-key $K --s3-secret-key $S --s3-url-style path
```

Two caveats before you rely on this:

- **Replicas do not see new Parquet files.** `refreshView()` is wired to the
  prune loop and only fires after that node deletes rows. A replica deletes
  nothing, so its view of the bucket is frozen at boot until the process
  restarts. Refreshing on a timer independent of pruning is not implemented yet.
- **Replicas lag by the hot window** — the writer's unarchived logs are
  invisible to them — and they still accept ingest. There is no read-only mode;
  role-based keys are the only lever.

### Topology 3 — Shard by Project

Each shard is its own binary, volume, and SQLite file, and all shards archive
into one bucket. Every shard can therefore query all _history_; only the recent
hot window is shard-local. Requires a router in front that maps project to
shard — relog does not ship one.

### On Fly.io

`fly.toml` describes one machine with one volume. `fly scale count 3` gives you
three machines with three separate volumes and no control over which one serves
a request — that is topology 3 without the router, and logs for one project will
scatter across shards. To scale properly, split into two apps (a writer with a
volume, and a volume-less replica group) or put the router in front.

`fly storage create` provisions Tigris and sets the S3 credentials, which is the
archive bucket topologies 2 and 3 are built on.

## Environment Variables

| Variable                    | Description                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `RELOG_URL`                 | Default relog.dev server URL for the Next.js integration                           |
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

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `bun run build`      | Build with bunup                                |
| `bun run build:bin`  | Build a [standalone binary](#standalone-binary) |
| `bun run dev`        | Build in watch mode                             |
| `bun test`           | Run tests                                       |
| `bun test --watch`   | Run tests in watch mode                         |
| `bun run lint`       | Run oxlint                                      |
| `bun run format`     | Run oxfmt                                       |
| `bun run type-check` | TypeScript type checking                        |
| `bun run release`    | Bump version, commit, push, and tag             |

## License

MIT
