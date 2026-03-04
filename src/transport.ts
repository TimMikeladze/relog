import type { LogRecord } from "./types.ts";

const activeTransports = new Set<Transport>();
let shutdownRegistered = false;

function registerShutdownHandlers(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;

	if (typeof process === "undefined") return;

	const flushAll = () => Promise.allSettled([...activeTransports].map((t) => t.flush()));

	const shutdownFlush = () => {
		// Keep event loop alive until flush completes
		const keepAlive = setInterval(() => {}, 1000);
		flushAll().finally(() => {
			clearInterval(keepAlive);
		});
	};
	process.on("SIGINT", shutdownFlush);
	process.on("SIGTERM", shutdownFlush);
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

		try {
			await this.sendBatch(batch);
		} finally {
			this.flushing = false;
			if (!this.destroyed && this.pendingFlush && this.buffer.length > 0) {
				this.pendingFlush = false;
				void this.flush();
			}
		}
	}

	private async sendBatch(batch: LogRecord[]): Promise<void> {
		if (typeof fetch === "undefined") {
			console.warn(`[relog.dev] fetch is not available, dropping ${batch.length} log(s)`);
			return;
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.auth) {
			const encoded =
				typeof Buffer !== "undefined" ? Buffer.from(this.auth).toString("base64") : btoa(this.auth);
			headers["Authorization"] = `Basic ${encoded}`;
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

				if (response.status < 500 && response.status !== 429) {
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
				console.warn(`[relog.dev] Failed to send ${batch.length} log(s): ${lastError.message}`);
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
