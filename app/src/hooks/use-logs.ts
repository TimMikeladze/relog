import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/api/client";
import type { Filters, LogRecord, LogsResponse } from "@/types";

const PAGE_SIZE = 100;

export function useLogs(filters: Filters, enabled: boolean) {
	const [rows, setRows] = useState<LogRecord[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(true);
	const offsetRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);

	const buildParams = useCallback(
		(offset: number): Record<string, string> => {
			const params: Record<string, string> = {
				limit: String(PAGE_SIZE),
				offset: String(offset),
			};
			if (filters.level) params.level = filters.level;
			if (filters.service) params.service = filters.service;
			if (filters.project) params.project = filters.project;
			if (filters.branch) params.branch = filters.branch;
			if (filters.version) params.version = filters.version;
			if (filters.deployment_id) params.deployment_id = filters.deployment_id;
			if (filters.grep) params.grep = filters.grep;
			if (filters.from) params.from = filters.from;
			if (filters.to) params.to = filters.to;
			if (filters.around_id) params.around_id = filters.around_id;
			return params;
		},
		[filters],
	);

	// Single fetch-from-zero implementation shared by the initial-fetch
	// effect and `refetch`. Hoisting prevents the two paths drifting apart
	// (which is how stale request handling, abort wiring, and error mapping
	// silently diverge over time).
	const fetchFromZero = useCallback(() => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setLoading(true);
		setError(null);
		setLoadMoreError(null);
		offsetRef.current = 0;

		apiGet<LogsResponse>("/logs", buildParams(0), controller.signal)
			.then((res) => {
				if (controller.signal.aborted) return;
				setRows(res.rows);
				setTotal(res.total);
				setHasMore(res.rows.length < res.total);
				offsetRef.current = res.rows.length;
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setError(err instanceof Error ? err.message : "Failed to fetch logs");
			})
			.finally(() => {
				if (controller.signal.aborted) return;
				setLoading(false);
			});

		return controller;
	}, [buildParams]);

	// Initial fetch (resets on filter change)
	useEffect(() => {
		if (!enabled) return;
		const controller = fetchFromZero();
		return () => {
			controller.abort();
		};
	}, [fetchFromZero, enabled]);

	const refetch = useCallback(() => {
		if (!enabled) return;
		fetchFromZero();
	}, [fetchFromZero, enabled]);

	// Load more (append). Errors are surfaced via `loadMoreError` so the
	// scroller can tell the user pagination failed instead of silently
	// stalling at the current page.
	const loadMore = useCallback(async () => {
		if (loadingMore || loading || !hasMore) return;
		setLoadingMore(true);
		setLoadMoreError(null);
		try {
			const res = await apiGet<LogsResponse>("/logs", buildParams(offsetRef.current));
			setRows((prev) => {
				const ids = new Set(prev.map((r) => r.id));
				const newRows = res.rows.filter((r) => !ids.has(r.id));
				return [...prev, ...newRows];
			});
			setTotal(res.total);
			offsetRef.current += res.rows.length;
			setHasMore(offsetRef.current < res.total);
		} catch (err) {
			setLoadMoreError(err instanceof Error ? err.message : "Failed to load more logs");
		} finally {
			setLoadingMore(false);
		}
	}, [buildParams, loadingMore, loading, hasMore]);

	return {
		rows,
		total,
		loading,
		loadingMore,
		error,
		loadMoreError,
		hasMore,
		loadMore,
		refetch,
	};
}
