import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/api/client";
import type { Filters, LogsResponse } from "@/types";

export function useLogs(filters: Filters, page: number, enabled: boolean, limit = 100) {
	const [data, setData] = useState<LogsResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetch = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const params: Record<string, string> = {
				limit: String(limit),
				offset: String((page - 1) * limit),
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

			const res = await apiGet<LogsResponse>("/logs", params);
			setData(res);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch logs");
		} finally {
			setLoading(false);
		}
	}, [filters, page, limit, enabled]);

	useEffect(() => {
		if (!enabled) return;
		fetch();
	}, [fetch, enabled]);

	return { data, loading, error, refetch: fetch };
}
