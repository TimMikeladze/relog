# OpenTelemetry example

Two ways to ship OTLP to relog.dev.

## Raw OTLP/JSON (zero deps)

Hand-crafted OTLP payload POSTed to `/v1/traces` and `/v1/logs`. Useful to see exactly what relog accepts.

```bash
# terminal 1
bunx relog.dev start

# terminal 2
bun examples/otel/otel-raw.ts
```

Emits one trace (3 spans: server → internal auth, client DB query) and one log record. Open http://localhost:3485 → Traces tab.

## OpenTelemetry SDK

Realistic production path using `@opentelemetry/sdk-node` with the OTLP/HTTP/JSON exporter.

```bash
bun add @opentelemetry/api @opentelemetry/sdk-node \
        @opentelemetry/resources @opentelemetry/semantic-conventions \
        @opentelemetry/exporter-trace-otlp-http

bun examples/otel/otel-sdk.ts
```

## Config

| Env          | Default                 | Description              |
| ------------ | ----------------------- | ------------------------ |
| `RELOG_URL`  | `http://localhost:3485` | relog server base URL    |
| `RELOG_AUTH` | —                       | Bearer token if auth set |

## What relog supports

- `POST /v1/traces` — OTLP/JSON traces
- `POST /v1/logs` — OTLP/JSON logs
- `Content-Encoding: gzip` on request bodies
- Trace/span IDs as hex OR base64 (normalized to hex)
- Span events → separate log records linked to the span
- `status.code = 2` → log level `error`
- Resource attributes (`service.name`, `host.name`, plus rest preserved in `meta.resource`)
- `span.kind`, `status_code`, `instrumentation_scope` surfaced in the span detail UI

Not yet supported: `application/x-protobuf` (returns 415), `/v1/metrics` (returns 501).

## Point any OTel exporter at relog

Works with any language's OTLP/HTTP/JSON exporter — just set the endpoint:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:3485
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
# optional auth
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer my-ingest-key"
```
