import { useCallback, useState } from "react";
import { apiPost } from "@/api/client";
import type { QueryResult } from "@/types";

export function useQueryExecute() {
	const [data, setData] = useState<QueryResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const execute = useCallback(async (sql: string) => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiPost<QueryResult>("/query", { sql });
			setData(res);
			return res;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Query failed";
			setError(msg);
			return null;
		} finally {
			setLoading(false);
		}
	}, []);

	const reset = useCallback(() => {
		setData(null);
		setError(null);
	}, []);

	return { data, loading, error, execute, reset };
}
