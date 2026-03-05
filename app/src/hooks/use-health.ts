import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/api/client";
import type { HealthResponse } from "@/types";

export function useHealth(enabled: boolean, intervalMs = 30_000) {
	const [data, setData] = useState<HealthResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

	const fetch = useCallback(async () => {
		try {
			const res = await apiGet<HealthResponse>("/health");
			setData(res);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch health");
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		fetch();
		timerRef.current = setInterval(fetch, intervalMs);
		return () => clearInterval(timerRef.current);
	}, [enabled, fetch, intervalMs]);

	return { data, error, refetch: fetch };
}
