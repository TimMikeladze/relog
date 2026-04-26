import type { RelogDatabase } from "../../db/database.ts";
import { VALID_LEVELS } from "../../types.ts";
import type { LogEntry, StreamFilters } from "../../types.ts";

type StreamClient = {
	controller: ReadableStreamDefaultController;
	filters: StreamFilters;
	lastPollId: number;
};

// Per-flush cap. Keep in sync with getLogsSince call below.
const FLUSH_BATCH_SIZE = 500;

// SSE backpressure cutoff. ReadableStream's `desiredSize` is `highWaterMark -
// queueSize`; with the default count-based HWM of 1 it goes negative as soon
// as the consumer falls behind. We allow up to ~1k backlogged messages before
// dropping the client — beyond that, the stream queue is the OOM risk.
const MAX_QUEUE_BACKLOG = 1_000;

function isBackpressured(controller: ReadableStreamDefaultController): boolean {
	const ds = controller.desiredSize;
	if (ds === null) return true; // stream errored/closed
	return ds < -MAX_QUEUE_BACKLOG;
}

function logMatchesFilter(log: LogEntry, filters: StreamFilters): boolean {
	for (const col of [
		"level",
		"service",
		"trace_id",
		"project",
		"branch",
		"version",
		"deployment_id",
	] as const) {
		const want = filters[col];
		if (!want) continue;
		const values = String(want).split(",").filter(Boolean);
		if (values.length === 0) continue;
		const actual = (log as unknown as Record<string, unknown>)[col];
		if (actual == null || !values.includes(String(actual))) return false;
	}
	return true;
}

export class StreamManager {
	private clients = new Set<StreamClient>();
	private db: RelogDatabase;
	private encoder = new TextEncoder();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private debounceMs: number;
	private maxClients: number;
	private heartbeatMs: number;
	private closed = false;

	constructor(
		db: RelogDatabase,
		debounceMs: number = 50,
		maxClients: number = 100,
		// 25s, not 30s: many proxies and load balancers idle-time-out at
		// exactly 30s (AWS ALB default, GCP HTTPS LB, Cloudflare). A 25s
		// heartbeat keeps the connection alive comfortably under that.
		heartbeatMs: number = 25_000,
	) {
		this.db = db;
		this.debounceMs = debounceMs;
		this.maxClients = maxClients;
		this.heartbeatMs = heartbeatMs;
		this.startHeartbeat();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.closed || this.clients.size === 0) return;
			const failed: StreamClient[] = [];
			for (const client of this.clients) {
				try {
					client.controller.enqueue(this.encoder.encode(": heartbeat\n\n"));
				} catch {
					failed.push(client);
				}
			}
			for (const client of failed) {
				this.clients.delete(client);
			}
		}, this.heartbeatMs);
	}

	notify(): void {
		if (this.closed || this.clients.size === 0) return;

		if (this.debounceTimer) return;

		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.flush();
		}, this.debounceMs);
	}

	get clientCount(): number {
		return this.clients.size;
	}

	addClient(client: StreamClient): boolean {
		if (this.clients.size >= this.maxClients) {
			return false;
		}
		this.clients.add(client);
		return true;
	}

	removeClient(client: StreamClient): void {
		this.clients.delete(client);
	}

	shutdown(): void {
		this.closed = true;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		for (const client of this.clients) {
			try {
				client.controller.enqueue(
					this.encoder.encode("event: close\ndata: server shutting down\n\n"),
				);
				client.controller.close();
			} catch {
				// already closed
			}
		}
		this.clients.clear();
	}

	private flush(): void {
		if (this.closed || this.clients.size === 0) return;

		// Single DB query for the lowest-watermark client; filter the result
		// per-client in memory. Replaces O(N_clients × DB query) with O(1 query).
		let minId = Number.POSITIVE_INFINITY;
		for (const client of this.clients) {
			if (client.lastPollId < minId) minId = client.lastPollId;
		}
		if (!Number.isFinite(minId)) return;

		let logs: LogEntry[];
		try {
			logs = this.db.getLogsSince(minId, {}, FLUSH_BATCH_SIZE);
		} catch {
			// DB may be closed during shutdown
			return;
		}
		if (logs.length === 0) return;

		const failed: StreamClient[] = [];

		const batchMaxId = logs[logs.length - 1]!.id ?? 0;

		for (const client of this.clients) {
			let clientFailed = false;
			if (isBackpressured(client.controller)) {
				failed.push(client);
				continue;
			}
			for (const log of logs) {
				if (clientFailed) break;
				if (!log.id || log.id <= client.lastPollId) continue;
				if (!logMatchesFilter(log, client.filters)) continue;
				try {
					client.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(log)}\n\n`));
					client.lastPollId = log.id;
					if (isBackpressured(client.controller)) {
						clientFailed = true;
						failed.push(client);
					}
				} catch {
					clientFailed = true;
					failed.push(client);
				}
			}
			// Advance past this batch even when nothing matched, so the next
			// flush doesn't re-evaluate the same window. notify() schedules
			// another flush whenever new rows arrive past batchMaxId.
			if (!clientFailed && batchMaxId > client.lastPollId) {
				client.lastPollId = batchMaxId;
			}
		}

		for (const client of failed) {
			this.clients.delete(client);
			try {
				client.controller.close();
			} catch {
				// already closed/errored
			}
		}

		// If we hit the batch cap, more rows are pending past batchMaxId.
		// Without this, a single far-behind client would starve current
		// clients: minId stays low, every flush serves the same old window,
		// and notify() debouncing prevents spontaneous catch-up flushes.
		// Re-arm via setImmediate so we yield between iterations.
		if (logs.length === FLUSH_BATCH_SIZE && !this.closed && this.clients.size > 0) {
			setImmediate(() => this.flush());
		}
	}
}

export function handleStream(
	request: Request,
	streamManager: StreamManager,
	db: RelogDatabase,
): Response {
	const url = new URL(request.url);
	const filters: StreamFilters = {};

	const level = url.searchParams.get("level");
	if (level) {
		const levels = level.split(",");
		if (levels.some((l) => !VALID_LEVELS.has(l))) {
			return Response.json({ error: `Invalid level '${level}'` }, { status: 400 });
		}
		filters.level = level;
	}
	const service = url.searchParams.get("service");
	if (service) filters.service = service;
	const traceId = url.searchParams.get("trace_id");
	if (traceId) filters.trace_id = traceId;
	const project = url.searchParams.get("project");
	if (project) filters.project = project;
	const branch = url.searchParams.get("branch");
	if (branch) filters.branch = branch;
	const version = url.searchParams.get("version");
	if (version) filters.version = version;
	const deploymentId = url.searchParams.get("deployment_id");
	if (deploymentId) filters.deployment_id = deploymentId;

	let client: StreamClient;
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			client = { controller, filters, lastPollId: db.getMaxId() };
			const added = streamManager.addClient(client);
			if (!added) {
				controller.enqueue(encoder.encode("event: error\ndata: Too many stream clients\n\n"));
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(": connected\n\n"));
		},
		cancel() {
			streamManager.removeClient(client);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
