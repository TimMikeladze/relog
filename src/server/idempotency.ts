/**
 * In-memory idempotency cache for ingest endpoints. When a client sends
 * `Idempotency-Key` (or `X-Idempotency-Key`), we cache the resulting
 * response for a TTL so that automatic retries (e.g. network blips,
 * Cloudflare retry-on-502) don't double-insert log batches.
 *
 * Scope is per auth-key prefix so two different ingest keys can use the
 * same idempotency value without collision. Storage is in-memory only —
 * a process restart loses the table, which is acceptable: clients should
 * re-emit the request with the same key, and the worst case is duplicate
 * logs for the brief window after restart.
 */
export interface CachedResponse {
	status: number;
	body: string;
	contentType: string;
	createdAt: number;
}

export class IdempotencyStore {
	private store = new Map<string, CachedResponse>();
	private ttlMs: number;
	private maxEntries: number;
	private lastGcAt = 0;
	private readonly GC_INTERVAL_MS = 60_000;

	constructor(ttlMs: number = 60 * 60_000, maxEntries: number = 10_000) {
		this.ttlMs = ttlMs;
		this.maxEntries = maxEntries;
	}

	private bucketKey(scope: string, keyPrefix: string | undefined, idemKey: string): string {
		// Scope segregates cache entries per route so that a client reusing
		// the same Idempotency-Key against different endpoints (/ingest vs
		// /v1/logs) does not get the wrong cached response served back.
		return `${scope}\x00${keyPrefix ?? "_anon"}\x00${idemKey}`;
	}

	get(scope: string, keyPrefix: string | undefined, idemKey: string): CachedResponse | null {
		this.maybeGc();
		const k = this.bucketKey(scope, keyPrefix, idemKey);
		const entry = this.store.get(k);
		if (!entry) return null;
		if (Date.now() - entry.createdAt > this.ttlMs) {
			this.store.delete(k);
			return null;
		}
		// LRU touch: re-insert moves the entry to the back of Map iteration
		// order so a still-active key isn't evicted under burst load.
		this.store.delete(k);
		this.store.set(k, entry);
		return entry;
	}

	put(
		scope: string,
		keyPrefix: string | undefined,
		idemKey: string,
		value: Omit<CachedResponse, "createdAt">,
	): void {
		const k = this.bucketKey(scope, keyPrefix, idemKey);
		// Replacing an existing key must move it to the back as well, so the
		// LRU ordering is consistent with `get`.
		this.store.delete(k);
		// Eviction: hard cap so a flood of unique keys can't exhaust memory.
		// Drop the least-recently-used (Map iteration order, kept current by
		// the touch in `get` and the delete-then-set above).
		if (this.store.size >= this.maxEntries) {
			const oldest = this.store.keys().next().value;
			if (oldest !== undefined) this.store.delete(oldest);
		}
		this.store.set(k, { ...value, createdAt: Date.now() });
	}

	private maybeGc(): void {
		const now = Date.now();
		if (now - this.lastGcAt < this.GC_INTERVAL_MS) return;
		this.lastGcAt = now;
		const cutoff = now - this.ttlMs;
		for (const [k, v] of this.store) {
			if (v.createdAt < cutoff) this.store.delete(k);
		}
	}
}

/**
 * Read the Idempotency-Key header (canonical form) or X-Idempotency-Key
 * (fallback used by some HTTP clients that strip non-X- prefixed custom
 * headers). Returns null if the value is absent or implausibly large —
 * we don't want a hostile client filling the cache with multi-KB keys.
 */
export function readIdempotencyKey(request: Request): string | null {
	const raw =
		request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");
	if (!raw) return null;
	const trimmed = raw.trim();
	if (trimmed.length === 0 || trimmed.length > 200) return null;
	return trimmed;
}

export function cachedToResponse(c: CachedResponse): Response {
	return new Response(c.body, {
		status: c.status,
		headers: {
			"Content-Type": c.contentType,
			"Idempotent-Replay": "true",
		},
	});
}
