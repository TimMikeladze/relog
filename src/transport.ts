import type { LogRecord } from "./types.ts";

const activeTransports = new Set<Transport>();
let shutdownRegistered = false;

const SHUTDOWN_DRAIN_TIMEOUT_MS = 5000;

function registerShutdownHandlers(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;

	if (typeof process === "undefined") return;

	// Drain everything: pending buffered batches AND any sendBatch already
	// in flight. Bound the wait so a hung HTTP request doesn't pin the
	// process forever — at SHUTDOWN_DRAIN_TIMEOUT_MS we give up and let
	// the process exit, dropping any still-in-flight batches.
	const drainAll = async () => {
		const flushes = [...activeTransports].map((t) => t.flush());
		const inflight = [...activeTransports].flatMap((t) => t.getInflight());
		const pending = Promise.allSettled([...flushes, ...inflight]);
		const timeout = new Promise<void>((resolve) => {
			const t = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
			if (typeof t === "object" && "unref" in t) t.unref();
		});
		await Promise.race([pending, timeout]);
	};

	const shutdownFlush = () => {
		// Pin the event loop while drain is running; clear it so the
		// process can exit immediately afterwards. Bun/Node would otherwise
		// have nothing keeping it alive once timers/intervals are unref'd.
		const keepAlive = setInterval(() => {}, 1000);
		drainAll().finally(() => clearInterval(keepAlive));
	};
	process.on("SIGINT", shutdownFlush);
	process.on("SIGTERM", shutdownFlush);
	// beforeExit fires when the loop is about to drain naturally — last
	// chance to flush leftover buffered logs that batched-but-never-sent.
	// Guard against re-entry: drainAll's async work re-arms the loop,
	// which would re-fire beforeExit and recurse forever.
	let beforeExitFired = false;
	process.on("beforeExit", () => {
		if (beforeExitFired) return;
		beforeExitFired = true;
		void drainAll();
	});
}

export class Transport {
	private buffer: LogRecord[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private url: string;
	private auth: string | undefined;
	private batchSize: number;
	private flushInterval: number;
	private maxBufferSize: number;
	private flushing = false;
	private pendingFlush = false;
	private destroyed = false;
	private onError: ((error: Error, batch: LogRecord[]) => void) | undefined;
	private inflight = new Set<Promise<void>>();

	constructor(options: {
		url: string;
		auth?: string;
		batchSize?: number;
		flushInterval?: number;
		maxBufferSize?: number;
		onError?: (error: Error, batch: LogRecord[]) => void;
	}) {
		this.url = options.url;
		this.auth = options.auth;
		this.batchSize = options.batchSize ?? 50;
		this.flushInterval = options.flushInterval ?? 5000;
		this.maxBufferSize = options.maxBufferSize ?? 10000;
		this.onError = options.onError;

		this.timer = setInterval(() => {
			void this.flush();
		}, this.flushInterval);
		this.timer.unref();

		activeTransports.add(this);
		registerShutdownHandlers();
	}

	send(record: LogRecord): void {
		if (this.destroyed) return;
		if (this.buffer.length >= this.maxBufferSize) {
			this.buffer.splice(0, Math.floor(this.maxBufferSize * 0.1));
		}
		this.buffer.push(record);
		if (this.buffer.length >= this.batchSize) {
			void this.flush();
		}
	}

	async flush(): Promise<void> {
		if (this.flushing) {
			this.pendingFlush = true;
			return;
		}
		if (this.buffer.length === 0) return;

		this.flushing = true;
		this.pendingFlush = false;

		const batch = this.buffer.splice(0);

		const sendPromise = this.sendBatch(batch);
		this.inflight.add(sendPromise);
		try {
			await sendPromise;
		} finally {
			this.inflight.delete(sendPromise);
			this.flushing = false;
			if (!this.destroyed && this.pendingFlush && this.buffer.length > 0) {
				this.pendingFlush = false;
				void this.flush();
			}
		}
	}

	/** Snapshot of in-flight sendBatch promises for the shutdown path. */
	getInflight(): Promise<void>[] {
		return [...this.inflight];
	}

	private async sendBatch(batch: LogRecord[]): Promise<void> {
		if (typeof fetch === "undefined") {
			console.warn(`[relog.sh] fetch is not available, dropping ${batch.length} log(s)`);
			return;
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.auth) {
			headers["Authorization"] = `Bearer ${this.auth}`;
		}

		let lastError: Error | undefined;

		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.destroyed) return;

			try {
				const response = await fetch(`${this.url}/ingest`, {
					method: "POST",
					headers,
					body: JSON.stringify(batch),
				});

				if (response.ok) return;

				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 10_000;
					lastError = new Error("Rate limited (429)");
					if (attempt < 2 && !this.destroyed) {
						await new Promise<void>((r) => {
							const t = setTimeout(r, waitMs);
							if (typeof t === "object" && "unref" in t) t.unref();
						});
					}
					continue;
				}

				if (response.status < 500) {
					lastError = new Error(`Ingest rejected: ${response.status}`);
					break;
				}
				lastError = new Error(`Ingest failed: ${response.status}`);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error("Network error");
			}

			if (attempt < 2 && !this.destroyed) {
				const delay = Math.min(2 ** attempt * 500, 5000);
				await new Promise<void>((r) => {
					const t = setTimeout(r, delay);
					if (typeof t === "object" && "unref" in t) t.unref();
				});
			}
		}

		if (lastError) {
			if (this.onError) {
				try {
					this.onError(lastError, batch);
				} catch {
					// onError should not throw
				}
			} else {
				console.warn(`[relog.sh] Failed to send ${batch.length} log(s): ${lastError.message}`);
			}
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		activeTransports.delete(this);
	}
}
