import { useCallback, useEffect, useState } from "react";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

export function useQuery(sql: string, enabled: boolean) {
	const [data, setData] = useState<QueryResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const execute = useCallback(async () => {
		if (!sql) return;
		setLoading(true);
		setError(null);
		try {
			const res = await apiPost<QueryResult>("/query", { sql });
			setData(res);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Query failed");
		} finally {
			setLoading(false);
		}
	}, [sql]);

	useEffect(() => {
		if (!enabled) return;
		execute();
	}, [execute, enabled]);

	return { data, loading, error, refetch: execute };
}
