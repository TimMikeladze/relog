# Production Readiness Checklist

Findings from holistic review of `src/` and `app/`. Cite `file:line`. P0 = blocker, P1 = should-fix, P2 = polish.

---

## P0 — Blockers

- [x] **LIMIT bypass in query validator** — `src/db/validate.ts:139-143`. Auto-append skipped if any `\bLIMIT \d+\b` appears anywhere (including subqueries). Outer query without LIMIT can return unbounded rows → OOM. Fix: detect top-level LIMIT only, or wrap as `SELECT * FROM (user_sql) LIMIT N`.
- [x] **DuckDB S3 init swallows real error** — `src/db/duckdb.ts:78-82`. `catch {}` discards cause; only generic message surfaces. Log original error (creds redacted), include code/class in rethrown message.
- [x] **Shutdown not awaited / no force flush** — `src/server/server.ts:308-317`. `Bun.sleep(3000)` then `db.close()`. Audit all callers `await shutdown()`. Verify `server.stop()` completes in-flight requests before sleep.
- [x] **Test suite shutdown race** — `src/server/server.test.ts` `afterAll()` must `await instance.shutdown()`. Without await: dangling DuckDB conns, port collisions, flaky CI.

## P1 — Should-fix

### Server / DB
- [x] **No PII / secret redaction on ingest meta** — raw JSON stored. Auth headers, tokens land unredacted.
- [x] **No idempotency on ingest** — `src/server/routes/ingest.ts`. Client retry → duplicate rows. Add idempotency key or content hash dedup.
- [x] **Rate limiter is global, not per-key** — `src/server/server.ts:27, 119`. One noisy key starves others. Move to per-key map.
- [x] **No structured logging in route handlers** — `src/server/routes/*.ts`. Failures return 4xx/5xx with no server log of key prefix, SQL, trace. Add `console.error` with structured context.
- [x] **`BLOCKED_FUNCTIONS` regex incomplete** — `src/db/validate.ts:5-6`. Missing: `parquet_metadata`, `parquet_schema`, `parquet_file_metadata`, `current_user`, `version`, `getenv`, `which_secret`. Add.
- [x] **`StreamManager.flush` is O(N_clients × DB query)** — `src/server/routes/stream.ts:107-128`. Per-burst N SQLite reads. Query once at min(lastPollId), filter per-client in memory.
- [x] **Archiver path traversal risk** — `src/archiver.ts`. Validate project/branch as `[a-zA-Z0-9._-]+`; reject special chars before building S3 key.
- [x] **Key prefix in ingest response** — `src/server/server.ts:172`. Don't echo prefix back to client; keep server-side only.
- [x] **Transport flush on SIGTERM not guaranteed** — `src/transport.ts:17-20`. Process can exit before pending HTTP batch resolves. Track inflight, block exit until drain or timeout.
- [x] **BIGINT coerce silent truncation** — `src/db/duckdb.ts:11-17`. `Number(bigint)` >2^53 truncates silently. Log warning at boundary.

### Frontend
- [x] **No React ErrorBoundary** — `app/src/App.tsx:247`. View crash crashes whole app. Wrap each view.
- [x] **`useAuth` doesn't distinguish auth-fail vs server-down** — `app/src/hooks/use-auth.tsx:56-62`. 500 from `/health` shown same as 401. Add retry-with-backoff + "server unreachable" UI.
- [x] **`useStream` deps thrash** — `app/src/hooks/use-stream.ts:82`. `filters` object identity changes each parent render → reconnect storm. Destructure stable primitives or memoize.
- [x] **`useWidgetData` deps thrash** — `app/src/hooks/use-widget-data.ts:89`. Same pattern. Each parent render refetches widget.
- [x] **Widget editor: no SQL preview/validation** — `app/src/components/dashboard/widget-editor.tsx`. Invalid SQL only fails at runtime. Add server-side `EXPLAIN` preview on save.
- [x] **Widget query failures kill dashboard refresh** — `app/src/hooks/use-widget-data.ts`. No isolation per widget; no stale-data fallback.
- [x] **Widget grid debounce loses layout on tab close** — `app/src/components/dashboard/widget-grid.tsx:74`. 2s debounce. Flush on `beforeunload`.
- [x] **`useStream` SSE parse fragile** — `app/src/hooks/use-stream.ts:54-58`. Splits on `\n` not `\n\n`. Works today because JSON has no raw newlines, but fragile.

## P2 — Polish

- [x] **No DB migration system** — `src/db/database.ts`. Schema changes ad-hoc. Add `schema_version` pragma + migration runner. (Note: brocli is just a CLI parser, not Drizzle ORM — no migration framework was present.)
- [x] **CORS `true` = wildcard** — `src/server/server.ts:75`. Document never use in prod. Add CI lint or runtime warn.
- [x] **No rate limit on `/health`** — `src/server/server.ts:160`. Unauth endpoint. Could spam logs.
- [x] **SSE heartbeat at 30s** — `src/server/routes/stream.ts:26`. Many proxies time out at exactly 30s. Drop to 25s.
- [x] **`MAX_BUFFER=10_000` log render** — `app/src/hooks/use-stream.ts:5`. Confirm `log-table.tsx` virtualizes. (Confirmed NOT virtualized; lowered MAX_BUFFER to 2_000 with comment.)
- [x] **`apiPost` / `apiPut` / `apiDelete` duplicated** — `app/src/api/client.ts:49-84`. Collapse to one helper.
- [x] **AuthDialog `onClose={() => {}}` when needs-auth** — `app/src/App.tsx:162`. No-op confusing.
- [x] **TS strictness gaps** — enable `noUnusedLocals`, `noPropertyAccessFromIndexSignature` in tsconfig. (`noUnusedLocals` enabled; `noPropertyAccessFromIndexSignature` deferred — produces ~250 errors across `process.env`, JSON meta, OTLP attrs that aren't real bugs.)
- [x] **No load test / benchmarks** — ingest RPS, query p99, stream client max. Added `test/load.test.ts` (gated on `LOAD_TEST=1`). Bench numbers on dev box: ingest ≈ 40k logs/sec, query p99 ≈ 11ms, stream fan-out 30/30 clients. Caught and fixed a pre-existing bug: DuckDB TIMESTAMP/DATE/etc. value-classes carry BigInt internally and broke `JSON.stringify` in `/query` (regression test added in `test/fixes.test.ts`).
- [ ] **No CHANGELOG / VERSION discipline** — verify before tagging release. (Process, not code.)
- [x] **Service color collisions** — `app/src/components/service-colors.ts`. Confirm hash function spreads adequately. (Test added; 40 sample names spread across ≥6 of 10 buckets, max bucket ≤30%.)
- [ ] **`command-palette` no search-by-shortcut** — minor. (Feature work, not polish.)

---

## Round 2 — Fresh holistic review (2026-04-27)

Re-review of `src/` and `app/` after first-pass fixes landed. New findings only.

### P1 — Should-fix

- [x] **Archiver Parquet INT32 overflow** — `src/archiver.ts:100,107`. Switched id+pid columns to INT64 with bigint arrays. Round-trip test still green (DuckDB reads INT64 as bigint, tests already coerce with `Number()`).
- [x] **Stream backpressure ignored** — `src/server/routes/stream.ts:159`. Per-client `controller.desiredSize` checked before/after each enqueue; client is dropped + closed when backlog exceeds 1000 messages.
- [x] **Widget SQL not validated server-side at write** — `src/server/routes/widgets.ts:49`. POST/PUT now stub out `${...}` placeholders with `NULL` and run `validateQuery` so blocked functions/keywords/multi-statements fail at save with a 400 instead of at render.
- [x] **Widgets file write is non-atomic** — `src/server/widgets.ts:83`. New `src/atomic-write.ts` (write→fsync→rename); both widgets and aggregates persistence use it. Crash mid-write no longer corrupts the JSON.
- [x] **Idempotency cache uses FIFO eviction, not LRU** — `src/server/idempotency.ts:60-62`. `get` and `put` now delete-then-reinsert so Map iteration order tracks recency. Eviction drops least-recently-used.
- [x] **`filter-bar.tsx` concurrent fetches race** — `app/src/components/dashboard/filter-bar.tsx`. Added monotonic request seq; only the latest-issued load writes state. AbortController would also work but `apiPost` doesn't accept a signal yet; this is the smaller change with the same outcome.
- [x] **`LogRow` memo defeated by inline callbacks** — `app/src/components/log-table.tsx:92, 154, 165`. `LogRow` callbacks now take `id`; `LogTable` keeps a single stable handler per mode via `useCallback` and a `logsRef`. `useBookmarks.toggle` made stable via a `bookmarksRef`. `selectedLog` memoized.

### P2 — Polish

- [x] **`useLogs.refetch` duplicates effect body** — `app/src/hooks/use-logs.ts:39-99`. Hoisted into a single `fetchFromZero` callback used by both the effect and `refetch`.
- [x] **`useLogs.loadMore` swallows errors silently** — `app/src/hooks/use-logs.ts:115`. Now exposes `loadMoreError`; the scroller can surface a retry affordance.
- [x] **`LogTable.selectedLog` O(n) on every render** — `app/src/components/log-table.tsx:38`. Memoized against `[selectedId, logs]` in iteration 2's stable-callback refactor.
- [x] **TraceWaterfall tree walk has no cycle guard** — `app/src/components/trace-waterfall.tsx:170-176`. Visited-set short-circuits cyclic parent chains; worst case is a truncated indent guide instead of a wrong tree.
- [x] **No backpressure / concurrency cap on widget grid auto-refresh** — `app/src/views/dashboard.tsx`. New `app/src/lib/query-gate.ts` queues all `/query` calls behind a shared 4-way semaphore so a slow tick can't fan out 12 parallel DuckDB calls.
- [x] **`server.ts` `/health` rate-limit is process-global, not per-IP** — `src/server/server.ts:175,222-228`. `healthLimiter` switched to `PerKeyRateLimiter` keyed on `x-forwarded-for[0]` then `server.requestIP(request)`; single misbehaving probe can no longer starve real ones (60 req/min/IP).
- [x] **`apiGet` swallows non-JSON error bodies** — `app/src/api/client.ts:43`. New `readErrorMessage` parses JSON when possible, then falls back to truncated text, then status text.

### Already-fixed / verified false positives this round

- `useHealth` stale-closure claim — `fetch` is in the effect's deps (`use-health.ts:25`). Not a bug.
- `useWidgetData.tick` not in deps — it is in `run`'s deps (`use-widget-data.ts:124`). Not a bug.
- `explore.tsx` leaking interval — cleanup runs on every effect re-run (`explore.tsx:51`). Not a bug.
- `JsonViewer` XSS — React escapes children by default. Not a bug.
- StreamManager `setImmediate` recursion — bounded by `lastPollId` advancement (`stream.ts:183`). Not a bug.

---

## Minimum to ship (single-tenant, internal)

- [x] All round-1 P0 fixed
- [x] ErrorBoundary added
- [x] `useStream` / `useWidgetData` identity-thrash fixed
- [x] Server-side `console.error` on every route catch
- [x] `/health` retry-with-backoff in frontend
- [x] Round-2 P1: archiver INT32, stream backpressure, widgets atomic write (widget SQL save-validation pending — see Round-2 list)

## Additional for multi-tenant / external

- [x] Per-key rate limit
- [x] Ingest dedup
- [x] PII / secret redaction
- [x] Complete `BLOCKED_FUNCTIONS` list
- [x] Archiver path sanitization
- [x] Idempotency LRU eviction (round-2 P1)
- [x] Per-IP `/health` rate limit (round-2 P2)
- [ ] Audit log of admin actions

---

## Round 3 — Re-review of CLI / sources / OTEL / widget renderers (2026-04-27)

Coverage gap pass. Hit areas rounds 1 & 2 didn't deeply touch: `src/cli/*`, `src/sources/*`, `src/server/routes/otel.ts`, `src/server/aggregates.ts`, `src/console.ts`, `src/logger.ts`, widget renderer components. New findings only.

### P1 — Should-fix

- [x] **`formatLogRecord` crashes on BigInt meta** — `src/console.ts:40`. `safeStringify` helper now passes a BigInt-aware replacer and falls back to `[unserializable meta]` on any other throw (cycles, throwing getters). Console formatter never aborts mid-record.
- [x] **Aggregates file write non-atomic** — `src/server/aggregates.ts:114`. Switched to `atomicWriteFile` (shared with widgets).
- [x] **Sources runner: dormant after sustained failure** — `src/sources/runner.ts:61-77`. Hard cap at 24 consecutive failures disables the source with an actionable log line. Added ±10% jitter to backoff to avoid thundering herd on shared upstream outage.
- [x] **Widget "stale" badge label is inverted** — `app/src/components/dashboard/widget-renderer.tsx:51`. Reflowed to a single string per branch with the full error in `title` so hover surfaces the cause.

### P2 — Polish

- [x] **`serializeError` drops `Error.cause` chain** — `src/logger.ts:24-30`. Recursively serialize, capped at depth 5 to bound cycles.
- [x] **`use-bookmarks` ignores `localStorage.setItem` quota errors** — `app/src/hooks/use-bookmarks.tsx:34, 42`. Wrapped in `safeSetItem` with a console.warn; React state setter no longer throws.
- [x] **`getting-started-dialog` ignores localStorage write failure** — both the read-on-init and the dismiss write are wrapped; dismissal is honored for the session even if persistence fails.
- [ ] **`TableWidget` uses array index as React key** — `app/src/components/dashboard/widgets/table.tsx:25`. Filter/sort triggers wrong row re-uses; minor with current static rendering, real bug if interactive sort is added.
- [x] **Heatmap NaN propagation when all cells null** — `app/src/components/dashboard/widgets/heatmap.tsx:22, 44`. False positive on re-read: `... || 1` already guards `max`, so `intensity = v/max` is bounded.
- [x] **`timeline-strip` no invalid-date guard** — `app/src/components/timeline-strip.tsx:115, 117`. Both ends now coerce `NaN` back to the 1h-default so the strip degrades gracefully instead of blanking.
- [ ] **Fragile timezone parsing via `toLocaleTimeString` split/pop** — `app/src/components/dashboard/widgets/format.ts:29`, `app/src/components/log-detail.tsx:29`. Assumes the last token is the offset. Locales differ (some have no TZ token, some use commas). Use `Intl.DateTimeFormat().resolvedOptions().timeZone` or `formatToParts`.
- [x] **`Pagination` returns Infinity when `limit === 0`** — `app/src/components/pagination.tsx:14`. Guarded.
- [x] **`json-viewer` no cycle detection** — `app/src/components/json-viewer.tsx:7`. Cycle-safe replacer (WeakSet) + BigInt coercion + final `[unserializable]` fallback. Detail panel never crashes.
- [x] **Sources exponential backoff has no jitter** — `src/sources/runner.ts:69`. ±10% jitter added (landed alongside the failure-cap fix in iteration 1).
- [x] **GitHub Actions cursor parse too lenient** — `src/sources/adapters/github-actions.ts:52-58`. Strict ISO-8601 regex (date+time+offset/Z) gates `Date.parse`; corrupted cursors return null and the caller treats them as "no cursor" rather than restarting from epoch.
- [x] **Aggregates 500 has no operator log** — `src/server/routes/aggregates.ts:57`. False positive on re-read: `logRouteError` is already called for both POST and PUT 500 paths.
- [ ] **Histogram `buckets` user-override vs adaptive overlap** — `src/server/routes/histogram.ts:64`. Validates `1..1000`; adaptive returns up to 360. User passing `500` works; passing `1500` 400s. Document behavior or unify.
- [ ] **Command palette / shortcuts dialog don't restore focus on close** — `app/src/components/command-palette.tsx`, `shortcuts-dialog.tsx`. Escape closes but focus is lost to `<body>`. Stash trigger ref and restore.

### Verified false positives (round 3)

- `gauge.tsx` div-by-zero — protected by `|| 1` short-circuit.
- `status-grid.tsx` `toFixed` on NaN — JS returns the string `"NaN"`, doesn't throw. Cosmetic only.
- CLI `process.exit` without transport flush in `send/search/query/stats` — those CLIs use one-shot `fetch`, not the buffered transport. Only `run.ts` uses transport, and it already awaits flush on shutdown.

---

---

## Round 4 — Next.js integration / MCP / migrations / pruner / auth (2026-04-27)

Coverage of remaining files: `src/next.ts`, `src/mcp.ts`, `src/server/middleware/auth.ts`, `src/db/migrations.ts`, `src/pruner.ts`, `src/cli/mcp.ts`, `src/index.ts`. Convergence pass — most of these are clean.

### P1 — Should-fix

- [x] **`createBrowserProxy` parses unbounded request body** — `src/next.ts:336`. Now checks `Content-Length` upfront and stream-reads with a `maxBodyBytes` cap (default 1 MiB; configurable). Returns 413 instead of buffering the whole body into V8 heap. Per-IP rate limit still left to the user's middleware.
- [x] **Edge-runtime ingest drops silently on misconfig** — `src/next.ts:250-256`. `.catch` now warns once-per-process via `originalConsole.warn` when the edge fetch fails, so a missing/misspelled `RELOG_URL` is visible in logs.

### P2 — Polish

- [x] **`patchConsole` misses `trace` / `group` / `table` / `dir`** — `src/next.ts:60-65`. Added `trace`. `group/table/dir` are display-only Node helpers — not log payloads — and stay out of the relog stream by design.
- [x] **`auth.ts` `safeEquals` re-hashes on every comparison** — `src/server/middleware/auth.ts:21-23`. Configured keys pre-hashed via a `WeakMap<AuthKeys, PrehashedKeys>`; per-request work is now `1 hash + N constant-time compares` instead of `1+N hashes`.
- [x] **`pruner.ts` no per-cycle wall-clock budget** — `src/pruner.ts:115`. Both `pruneByAge` and `pruneBySize` accept a `budgetMs` (default 30s); they exit early with a warn line and the next interval picks up where they left off.
- [ ] **`migrations.ts` no `down()` migrations** — by design (single-tenant), but document the upgrade-only stance in CONTRIBUTING so contributors don't expect rollback.

### Convergence note

Rounds 1–4 have now covered every non-test file in `src/` and every non-test file in `app/src/`. Subsequent reviews will likely surface only nits or duplicates.

---

## Verdict (final, post round 4)

**Single-tenant internal use:** ship-ready. All round-2/3/4 P1s landed (archiver INT64, SSE backpressure, widgets+aggregates atomic write, BigInt-safe console, sources dormancy + jitter, `createBrowserProxy` body cap, edge-runtime drop visibility).

**Multi-tenant / external:** ship-ready except for an admin-action audit log (process/policy work, not code). Idempotency LRU, per-IP `/health` rate limit, widget SQL save-validation, and the auth pre-hash perf fix all landed.

**Open P2s** (quality-of-life, none block ship):
- `TableWidget` array-index keys (only matters if interactive sort lands)
- `toLocaleTimeString` TZ token parsing fragility
- Histogram `buckets` user-vs-adaptive cap unification (doc)
- Command palette / shortcuts dialog focus restore on close
- Process: CHANGELOG / VERSION discipline; `migrations.ts` upgrade-only doc

**Open feature work** (not polish): command-palette search-by-shortcut.
