import { useCallback, useEffect, useRef, useState } from "react";
import { getAuthKey, getBaseUrl } from "@/api/client";
import type { Filters, LogRecord } from "@/types";

const MAX_BUFFER = 10_000;
const MAX_BACKOFF = 30_000;

export function useStream(filters: Filters, enabled: boolean) {
	const [logs, setLogs] = useState<LogRecord[]>([]);
	const [connected, setConnected] = useState(false);
	const [paused, setPaused] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const backoffRef = useRef(1000);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const connect = useCallback(() => {
		if (paused || !enabled) return;

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		const url = new URL("/stream", getBaseUrl());
		if (filters.level) url.searchParams.set("level", filters.level);
		if (filters.service) url.searchParams.set("service", filters.service);
		if (filters.project) url.searchParams.set("project", filters.project);
		if (filters.branch) url.searchParams.set("branch", filters.branch);
		if (filters.version) url.searchParams.set("version", filters.version);
		if (filters.deployment_id) url.searchParams.set("deployment_id", filters.deployment_id);

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
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (line.startsWith("data: ")) {
							try {
								const log = JSON.parse(line.slice(6)) as LogRecord;
								setLogs((prev) => {
									const next = [...prev, log];
									return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
								});
							} catch {
								// ignore parse errors
							}
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
	}, [filters, paused, enabled]);

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
