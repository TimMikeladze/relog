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
	const [hasMore, setHasMore] = useState(true);
	const offsetRef = useRef(0);
	const filtersRef = useRef(filters);

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
			return params;
		},
		[filters],
	);

	// Initial fetch (resets on filter change)
	const fetchInitial = useCallback(async () => {
		setLoading(true);
		setError(null);
		offsetRef.current = 0;
		try {
			const res = await apiGet<LogsResponse>("/logs", buildParams(0));
			setRows(res.rows);
			setTotal(res.total);
			setHasMore(res.rows.length < res.total);
			offsetRef.current = res.rows.length;
			filtersRef.current = filters;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch logs");
		} finally {
			setLoading(false);
		}
	}, [buildParams, filters]);

	useEffect(() => {
		if (!enabled) return;
		fetchInitial();
	}, [fetchInitial, enabled]);

	// Load more (append)
	const loadMore = useCallback(async () => {
		if (loadingMore || loading || !hasMore) return;
		setLoadingMore(true);
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
		} catch {
			// silently fail on load-more
		} finally {
			setLoadingMore(false);
		}
	}, [buildParams, loadingMore, loading, hasMore]);

	return { rows, total, loading, loadingMore, error, hasMore, loadMore, refetch: fetchInitial };
}
