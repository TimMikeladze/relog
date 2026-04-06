# Sources: Continuous External Log Ingestion

## Goal

Add a source adapter system that continuously pulls logs from external systems (GitHub Actions, Vercel, etc.) into relog. Sources run as background tasks alongside the server, similar to the existing auto-pruner.

## Architecture

Sources follow the same pattern as `pruner.ts` — background interval timers started in `startServer()`, with a handle for graceful shutdown. Each adapter is a function that yields batches of `IngestPayload[]`. Cursor state lives in a new SQLite table so sources survive restarts.

```
sources.yaml → SourceRunner (interval timer) → Adapter.pull(cursor) → db.insert() → streamManager.notify()
```

## Steps

### 1. Source types and adapter interface

**File:** `src/sources/types.ts`

```typescript
interface SourceAdapter {
	name: string;
	pull(config: Record<string, unknown>, cursor: string | null): AsyncIterable<PullBatch>;
}

interface PullBatch {
	logs: IngestPayload[];
	cursor: string; // opaque string, adapter-defined
}

interface SourceConfig {
	adapter: string;
	every: number; // seconds
	[key: string]: unknown; // adapter-specific params (repo, project, token, etc.)
}
```

### 2. Cursor state table

**File:** `src/db/schema.ts` (add table), `src/db/database.ts` (add methods)

New table:

```sql
CREATE TABLE IF NOT EXISTS source_cursors (
  source_id TEXT PRIMARY KEY,
  cursor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)
```

Add `getCursor(id)`, `setCursor(id, cursor)` to `RelogDatabase`.

### 3. Config file parser

**File:** `src/sources/config.ts`

- Parse YAML file (use `bun` built-in or a small parser)
- Resolve `$ENV_VAR` references in string values
- Validate with zod
- Return `SourceConfig[]`

### 4. Source runner

**File:** `src/sources/runner.ts`

Similar to `startAutoPrune()`:

- Takes `db`, `streamManager`, `SourceConfig[]`, adapter registry
- For each source config, starts a `setInterval` at the configured `every`
- Each tick: get cursor from DB → call `adapter.pull()` → `db.insert()` → save new cursor → `streamManager.notify()`
- Guard against overlapping runs (same `inFlight` pattern as pruner)
- Returns a `SourcesHandle` with `stop()` for graceful shutdown

### 5. GitHub Actions adapter

**File:** `src/sources/adapters/github-actions.ts`

- Uses GitHub REST API (`/repos/{owner}/{repo}/actions/runs` and `/repos/{owner}/{repo}/actions/runs/{id}/logs`)
- Cursor: `"TIMESTAMP|RUN_ID,RUN_ID,..."` — timestamp for API filtering, seen IDs for dedup at boundary
- Fetches completed workflow runs since cursor timestamp, skips already-seen IDs
- Downloads log zip for each run, extracts lines
- Maps to `IngestPayload`:
  - `project` ← repo name
  - `branch` ← head_branch
  - `trace_id` ← run ID
  - `service` ← job name
  - `version` ← head_sha
  - `meta.step` ← step name
  - `meta.workflow` ← workflow name
  - `level` ← `error` if conclusion=failure, `info` otherwise
  - `timestamp` ← step start time

### 6. Wire into server

**Files:** `src/server/server.ts`, `src/cli/serve.ts`, `src/types.ts`

- Add `sources?: SourceConfig[]` to `ServerConfig`
- Add `--sources` flag to `startCommand` (path to YAML file)
- In `startServer()`, after pruner setup, start source runner
- Add `sourcesHandle` to `ServerInstance`, call `.stop()` in `shutdown()`

### 7. Adapter registry

**File:** `src/sources/registry.ts`

Simple map of adapter name → adapter. Start with just `github-actions`. Easy to add more later.

## Config file format

```yaml
sources:
  - adapter: github-actions
    repo: myorg/app
    token: $GITHUB_TOKEN
    every: 60
  - adapter: github-actions
    repo: myorg/api
    token: $GITHUB_TOKEN
    every: 60
```

## Build order

1 → 2 → 3 → 7 → 4 → 5 → 6

Steps 1-4 and 7 are the framework. Step 5 is the first adapter. Step 6 wires it all together.

## Non-goals (for now)

- CLI `relog pull` one-shot command (can add later, reuses adapters)
- Dynamic source management via API (just restart with new config)
- Custom field mapping overrides (sensible defaults per adapter)
- Adapter plugins as separate packages
