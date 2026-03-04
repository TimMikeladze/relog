import type { RelogDatabase } from "../../db/database.ts";
import { VALID_LEVELS } from "../../types.ts";
import type { LogLevel, StreamFilters } from "../../types.ts";

type StreamClient = {
	controller: ReadableStreamDefaultController;
	filters: StreamFilters;
	lastPollId: number;
};

export class StreamManager {
	private clients = new Set<StreamClient>();
	private db: RelogDatabase;
	private encoder = new TextEncoder();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private debounceMs: number;
	private maxClients: number;
	private closed = false;

	constructor(db: RelogDatabase, debounceMs: number = 50, maxClients: number = 100) {
		this.db = db;
		this.debounceMs = debounceMs;
		this.maxClients = maxClients;
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
		for (const client of this.clients) {
			try {
				client.controller.close();
			} catch {
				// already closed
			}
		}
		this.clients.clear();
	}

	private flush(): void {
		if (this.closed || this.clients.size === 0) return;

		const failed: StreamClient[] = [];

		for (const client of this.clients) {
			try {
				const logs = this.db.getLogsSince(client.lastPollId, client.filters, 500);
				if (logs.length === 0) continue;

				let clientFailed = false;
				for (const log of logs) {
					if (clientFailed) break;
					try {
						client.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(log)}\n\n`));
						if (log.id && log.id > client.lastPollId) {
							client.lastPollId = log.id;
						}
					} catch {
						clientFailed = true;
						failed.push(client);
					}
				}
			} catch {
				// DB may be closed during shutdown
			}
		}

		for (const client of failed) {
			this.clients.delete(client);
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
		if (!VALID_LEVELS.has(level)) {
			return Response.json({ error: `Invalid level '${level}'` }, { status: 400 });
		}
		filters.level = level as LogLevel;
	}
	const service = url.searchParams.get("service");
	if (service) filters.service = service;
	const traceId = url.searchParams.get("trace_id");
	if (traceId) filters.trace_id = traceId;
	const project = url.searchParams.get("project");
	if (project) filters.project = project;
	const branch = url.searchParams.get("branch");
	if (branch) filters.branch = branch;

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
