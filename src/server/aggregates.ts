import { promises as fs } from "fs";
import { dirname } from "path";
import { atomicWriteFile } from "../atomic-write.ts";
import type { Aggregate } from "../types.ts";

const DEFAULT_AGGREGATES: Aggregate[] = [
	{
		id: "errors-last-hour",
		name: "Errors (Last Hour)",
		description: "All error and fatal logs from the last hour",
		filters: { level: "error,fatal", from: "1h" },
		icon: "AlertCircle",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	},
	{
		id: "warnings-last-hour",
		name: "Warnings (Last Hour)",
		description: "All warnings from the last hour",
		filters: { level: "warn", from: "1h" },
		icon: "AlertTriangle",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	},
	{
		id: "production-errors",
		name: "Production Errors",
		description: "Error logs from production deployment",
		filters: { level: "error,fatal", deployment_id: "prod" },
		icon: "Flame",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	},
];

export class AggregatesManager {
	private aggregates: Map<string, Aggregate> = new Map();
	private filePath: string | null = null;

	constructor(filePath?: string) {
		this.filePath = filePath || null;
	}

	async init(): Promise<void> {
		for (const agg of DEFAULT_AGGREGATES) {
			this.aggregates.set(agg.id, agg);
		}

		if (!this.filePath) return;
		let data: string;
		try {
			data = await fs.readFile(this.filePath, "utf-8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
			throw new Error(
				`[relog.dev] Failed to read aggregates file ${this.filePath}: ${err instanceof Error ? err.message : err}`,
			);
		}
		try {
			const loaded = JSON.parse(data) as Aggregate[];
			for (const agg of loaded) {
				this.aggregates.set(agg.id, agg);
			}
		} catch (err) {
			throw new Error(
				`[relog.dev] Aggregates file ${this.filePath} is corrupted: ${err instanceof Error ? err.message : err}. Move/restore it manually.`,
			);
		}
	}

	async add(aggregate: Omit<Aggregate, "createdAt" | "updatedAt">): Promise<Aggregate> {
		const now = Date.now();
		const agg: Aggregate = {
			...aggregate,
			createdAt: now,
			updatedAt: now,
		};
		this.aggregates.set(agg.id, agg);
		await this.persist();
		return agg;
	}

	async update(
		id: string,
		updates: Partial<Omit<Aggregate, "id" | "createdAt">>,
	): Promise<Aggregate | null> {
		const existing = this.aggregates.get(id);
		if (!existing) return null;
		const updated: Aggregate = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};
		this.aggregates.set(id, updated);
		await this.persist();
		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const had = this.aggregates.has(id);
		this.aggregates.delete(id);
		await this.persist();
		return had;
	}

	getAll(): Aggregate[] {
		return Array.from(this.aggregates.values()).sort((a, b) => a.createdAt - b.createdAt);
	}

	get(id: string): Aggregate | null {
		return this.aggregates.get(id) || null;
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			const dir = dirname(this.filePath);
			await fs.mkdir(dir, { recursive: true });
			const data = Array.from(this.aggregates.values());
			await atomicWriteFile(this.filePath, JSON.stringify(data, null, 2));
		} catch (error) {
			console.error("[relog] Failed to persist aggregates:", error);
		}
	}
}
