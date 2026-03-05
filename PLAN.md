# Plan: Apply "Logging Sucks" Lessons to relog.dev

## Key Lessons from the Article

1. **Wide events > scattered log lines** — one comprehensive event per unit of work with ALL context
2. **Build the event throughout the request, emit once at the end** — accumulate context like a lint roller
3. **Optimize for querying, not writing** — structured key-value pairs, not string interpolation
4. **Tail sampling for cost** — always keep errors/slow, sample the rest

## DX-First Design

The API should feel like a natural extension of the existing Logger. No ceremony, no boilerplate, chainable, and hard to misuse.

### Usage Examples

**Basic — chain it all:**
```ts
logger.event("checkout")
  .set("user_id", "usr_123")
  .set("cart_items", 3)
  .end();
// emits one wide event with duration_ms auto-calculated
```

**Request lifecycle — build up over time:**
```ts
const ev = logger.event("http_request");
ev.set("method", req.method);
ev.set("path", req.url);

const user = await authenticate(req);
ev.set("user_id", user.id);
ev.set("org_id", user.orgId);

try {
  const result = await handleRequest(req);
  ev.set("status", 200);
  ev.set("response_size", result.length);
} catch (err) {
  ev.set("status", 500);
  ev.error(err); // records error + auto-escalates level
}

ev.end(); // single wide event with everything
```

**Bulk set:**
```ts
ev.set({ method: "POST", path: "/api/pay", user_id: "usr_1" });
```

**Auto-cleanup with `using` (TC39 Explicit Resource Management):**
```ts
{
  using ev = logger.event("db_query");
  ev.set("table", "users");
  ev.set("query", "SELECT ...");
  // auto-emits on scope exit via Symbol.dispose
}
```

**Child events inherit parent context:**
```ts
const reqLogger = logger.child({ requestId: "abc" });
const ev = reqLogger.event("process_payment");
// ev automatically has requestId, service, project, branch, trace_id
```

## Files to Create/Modify

1. **`src/event.ts`** (NEW) — `EventBuilder` class
2. **`src/logger.ts`** — Add `.event()` method
3. **`src/types.ts`** — Add `EventBuilderOptions` type
4. **`src/console.ts`** — Show duration in formatted output for wide events
5. **`src/browser.ts`** — Add `.event()` to `BrowserLogger` + singleton
6. **`src/client.ts`** — Export `EventBuilder`
7. **`test/client.test.ts`** — Tests for EventBuilder

## EventBuilder API

```ts
class EventBuilder {
  set(key: string, value: unknown): this;       // single key
  set(obj: Record<string, unknown>): this;       // bulk set (overload)
  error(err: Error): this;                       // record error + escalate level
  warn(message?: string): this;                  // escalate to warn
  end(): void;                                   // emit the wide event
  [Symbol.dispose](): void;                      // auto-end via `using`
}
```

### Auto-Level Escalation
- Default: `info`
- `.warn()` → `warn`
- `.error()` → `error`
- Higher level always wins (never downgrades)

### What Gets Emitted
A single `LogRecord` where:
- `message` = event name (e.g. `"http_request"`)
- `meta` = all accumulated key-value pairs + `{ duration_ms, event: true }`
- `level` = auto-escalated based on errors/warns
- `trace_id`, `service`, `project`, `branch` = inherited from logger

### Console Output for Wide Events
```
14:32:05.123 INFO  [my-app@main] [api] http_request (142ms) {method: "POST", path: "/checkout", user_id: "usr_123", status: 200}
```
Duration shown inline when `meta.duration_ms` is present.
