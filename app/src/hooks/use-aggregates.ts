import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import type { Aggregate } from "@/types";

export function useAggregates() {
	const [aggregates, setAggregates] = useState<Aggregate[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchAggregates = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await apiGet<{ aggregates: Aggregate[] }>("/aggregates");
			setAggregates(res.aggregates || []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch aggregates");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchAggregates();
	}, [fetchAggregates]);

	const create = useCallback(
		async (aggregate: Omit<Aggregate, "createdAt" | "updatedAt">) => {
			try {
				const res = await apiPost<{ aggregate: Aggregate }>("/aggregates", aggregate);
				if (res.aggregate) {
					setAggregates((prev) => [...prev, res.aggregate]);
					return res.aggregate;
				}
			} catch (err) {
				console.error("Failed to create aggregate:", err);
				throw err;
			}
		},
		[],
	);

	const update = useCallback(
		async (id: string, updates: Partial<Omit<Aggregate, "id" | "createdAt">>) => {
			try {
				const res = await apiPut<{ aggregate: Aggregate }>(`/aggregates/${id}`, updates);
				if (res.aggregate) {
					setAggregates((prev) =>
						prev.map((agg) => (agg.id === id ? res.aggregate : agg)),
					);
					return res.aggregate;
				}
			} catch (err) {
				console.error("Failed to update aggregate:", err);
				throw err;
			}
		},
		[],
	);

	const delete_ = useCallback(async (id: string) => {
		try {
			await apiDelete(`/aggregates/${id}`);
			setAggregates((prev) => prev.filter((agg) => agg.id !== id));
		} catch (err) {
			console.error("Failed to delete aggregate:", err);
			throw err;
		}
	}, []);

	return { aggregates, loading, error, create, update, delete: delete_, refetch: fetchAggregates };
}
