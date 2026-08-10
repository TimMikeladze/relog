import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/api/client";
import type { HealthResponse } from "@/types";

interface HealthState {
	data: HealthResponse | null;
	error: string | null;
}

/**
 * One poller for the whole app. The status bar, the nav sidebar and the
 * dashboard all want the same `/health` snapshot; giving each its own interval
 * multiplied the request rate against the log server for identical data.
 * Subscribers share the response and the fastest requested interval wins.
 */
let state: HealthState = { data: null, error: null };
const subscribers = new Set<(s: HealthState) => void>();
const intervals = new Map<symbol, number>();
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | null = null;

function emit(next: HealthState) {
	state = next;
	for (const notify of subscribers) notify(state);
}

function fetchHealth(): Promise<void> {
	// Collapse concurrent calls — mount of several consumers in the same tick
	// should still produce a single request.
	if (inFlight) return inFlight;
	inFlight = apiGet<HealthResponse>("/health")
		.then((data) => emit({ data, error: null }))
		.catch((err) => {
			emit({
				data: state.data,
				error: err instanceof Error ? err.message : "Failed to fetch health",
			});
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

function restartTimer() {
	if (timer) clearInterval(timer);
	timer = undefined;
	if (intervals.size === 0) return;
	const interval = Math.min(...intervals.values());
	timer = setInterval(fetchHealth, interval);
}

export function useHealth(enabled: boolean, intervalMs = 30_000) {
	const [local, setLocal] = useState<HealthState>(state);

	useEffect(() => {
		if (!enabled) return;
		const key = Symbol("health-subscriber");
		subscribers.add(setLocal);
		intervals.set(key, intervalMs);
		restartTimer();
		fetchHealth();
		return () => {
			subscribers.delete(setLocal);
			intervals.delete(key);
			restartTimer();
		};
	}, [enabled, intervalMs]);

	const refetch = useCallback(() => fetchHealth(), []);

	return { data: local.data, error: local.error, refetch };
}
