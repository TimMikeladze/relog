import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthKey, getBaseUrl } from "@/api/client";
import type { Filters, LogRecord } from "@/types";

// log-table.tsx renders rows via a plain `.map()` — no virtualization.
// 10k DOM rows tanks scroll perf and explodes memory; 2k keeps the live
// stream useful without melting the browser. If/when the table is moved
// to a windowed renderer, this can grow back up.
const MAX_BUFFER = 2_000;
const MAX_BACKOFF = 30_000;

/**
 * Parse SSE event blocks. Spec: events are delimited by `\n\n`. A single
 * event may contain multiple `data:` lines whose values are joined with
 * `\n`. The previous split-on-`\n` worked only because our server emits
 * single-line JSON, but would break the moment a payload contained a
 * literal newline. Returns the consumed events plus any trailing partial
 * block to carry into the next read.
 */
function consumeBuffer(buffer: string): { events: string[]; rest: string } {
	const events: string[] = [];
	let lastConsumedEnd = 0;
	let cursor = 0;
	while (cursor < buffer.length) {
		const end = buffer.indexOf("\n\n", cursor);
		if (end === -1) break;
		const block = buffer.slice(cursor, end);
		const dataLines: string[] = [];
		for (const line of block.split("\n")) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).replace(/^ /, ""));
			}
		}
		if (dataLines.length > 0) events.push(dataLines.join("\n"));
		cursor = end + 2;
		lastConsumedEnd = cursor;
	}
	return { events, rest: buffer.slice(lastConsumedEnd) };
}

export function useStream(filters: Filters, enabled: boolean) {
	const [logs, setLogs] = useState<LogRecord[]>([]);
	const [connected, setConnected] = useState(false);
	const [paused, setPaused] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const backoffRef = useRef(1000);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	// Stabilize the filter identity. Parents pass a fresh `filters` object on
	// every render, which used to invalidate the connect callback and trigger
	// a reconnect storm whenever any unrelated state changed. By memoizing
	// against the actual filter values, we only reconnect when the filter
	// content genuinely changes.
	const stableFilters = useMemo(
		() => ({
			level: filters.level ?? null,
			service: filters.service ?? null,
			project: filters.project ?? null,
			branch: filters.branch ?? null,
			version: filters.version ?? null,
			deployment_id: filters.deployment_id ?? null,
		}),
		[
			filters.level,
			filters.service,
			filters.project,
			filters.branch,
			filters.version,
			filters.deployment_id,
		],
	);

	const connect = useCallback(() => {
		if (paused || !enabled) return;

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		const url = new URL("/stream", getBaseUrl());
		if (stableFilters.level) url.searchParams.set("level", stableFilters.level);
		if (stableFilters.service) url.searchParams.set("service", stableFilters.service);
		if (stableFilters.project) url.searchParams.set("project", stableFilters.project);
		if (stableFilters.branch) url.searchParams.set("branch", stableFilters.branch);
		if (stableFilters.version) url.searchParams.set("version", stableFilters.version);
		if (stableFilters.deployment_id)
			url.searchParams.set("deployment_id", stableFilters.deployment_id);

		const headers: Record<string, string> = { Accept: "text/event-stream" };
		const key = getAuthKey();
		if (key) headers["Authorization"] = `Bearer ${key}`;

		fetch(url.toString(), { headers, signal: controller.signal })
			.then(async (res) => {
				if (!res.ok || !res.body) {
					const err = new Error(`Stream failed: ${res.status}`);
					(err as { status?: number }).status = res.status;
					throw err;
				}
				setConnected(true);
				backoffRef.current = 1000;

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const { events, rest } = consumeBuffer(buffer);
					buffer = rest;
					for (const data of events) {
						try {
							const log = JSON.parse(data) as LogRecord;
							setLogs((prev) => {
								const next = [...prev, log];
								return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
							});
						} catch {
							// ignore parse errors (heartbeats, malformed payload)
						}
					}
				}
			})
			.catch((err) => {
				if (err.name === "AbortError") return;
				setConnected(false);
				// Don't retry on auth errors — would loop forever
				const status = (err as { status?: number }).status;
				if (status === 401 || status === 403) return;
				const delay = backoffRef.current;
				backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
				reconnectTimerRef.current = setTimeout(connect, delay);
			});
	}, [stableFilters, paused, enabled]);

	useEffect(() => {
		setLogs([]);
		connect();
		return () => {
			abortRef.current?.abort();
			abortRef.current = null;
			clearTimeout(reconnectTimerRef.current);
			setConnected(false);
		};
	}, [connect]);

	const pause = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		clearTimeout(reconnectTimerRef.current);
		setConnected(false);
		setPaused(true);
	}, []);

	const resume = useCallback(() => {
		setPaused(false);
	}, []);

	const clear = useCallback(() => {
		setLogs([]);
	}, []);

	return { logs, connected, paused, pause, resume, clear };
}
