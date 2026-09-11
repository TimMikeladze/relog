import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { atomicWriteFile } from "../atomic-write.ts";
import type { Dashboard, DashboardsFile } from "../types.ts";

/**
 * Dashboards are named collections of widgets plus the variables those
 * widgets can filter by. Widgets already carry arbitrary SQL, so a dashboard
 * adds exactly two things the widget layer could not express on its own:
 * which widgets belong together, and what the user is allowed to change
 * across all of them at once.
 */

/** Widgets with no `dashboardId` land here, so pre-dashboard widgets stay visible. */
export const DEFAULT_DASHBOARD_ID = "logs";

export class DashboardsManager {
	private dashboards: Map<string, Dashboard> = new Map();
	private filePath: string | null;

	constructor(filePath?: string) {
		this.filePath = filePath || null;
	}

	async init(): Promise<void> {
		for (const d of DEFAULT_DASHBOARDS) {
			this.dashboards.set(d.id, d);
		}
		if (!this.filePath) return;
		let raw: string;
		try {
			raw = await fs.readFile(this.filePath, "utf-8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				await this.persist();
				return;
			}
			// Same reasoning as the widgets store: a transient read failure must
			// not be answered by overwriting the user's file with defaults.
			throw new Error(
				`[relog.sh] Failed to read dashboards file ${this.filePath}: ${err instanceof Error ? err.message : err}`,
			);
		}
		try {
			const parsed = JSON.parse(raw) as DashboardsFile | Dashboard[];
			const list = Array.isArray(parsed) ? parsed : parsed.dashboards;
			for (const d of list) {
				this.dashboards.set(d.id, d);
			}
		} catch (err) {
			throw new Error(
				`[relog.sh] Dashboards file ${this.filePath} is corrupted: ${err instanceof Error ? err.message : err}. Move/restore it manually.`,
			);
		}
	}

	async add(dashboard: Omit<Dashboard, "createdAt" | "updatedAt">): Promise<Dashboard> {
		const now = Date.now();
		const d: Dashboard = { ...dashboard, createdAt: now, updatedAt: now };
		this.dashboards.set(d.id, d);
		await this.persist();
		return d;
	}

	async update(
		id: string,
		updates: Partial<Omit<Dashboard, "id" | "createdAt">>,
	): Promise<Dashboard | null> {
		const existing = this.dashboards.get(id);
		if (!existing) return null;
		const updated: Dashboard = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};
		this.dashboards.set(id, updated);
		await this.persist();
		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const d = this.dashboards.get(id);
		if (!d) return false;
		if (d.builtin) return false;
		this.dashboards.delete(id);
		await this.persist();
		return true;
	}

	getAll(): Dashboard[] {
		return Array.from(this.dashboards.values()).sort(
			(a, b) => (a.order ?? 100) - (b.order ?? 100) || a.createdAt - b.createdAt,
		);
	}

	get(id: string): Dashboard | null {
		return this.dashboards.get(id) || null;
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			await fs.mkdir(dirname(this.filePath), { recursive: true });
			const body: DashboardsFile = {
				version: 1,
				dashboards: Array.from(this.dashboards.values()),
			};
			await atomicWriteFile(this.filePath, JSON.stringify(body, null, 2));
		} catch (err) {
			console.error("[relog.sh] Failed to persist dashboards:", err);
		}
	}
}

const BUILTIN_TS = 0;

export const DEFAULT_DASHBOARDS: Dashboard[] = [
	{
		id: DEFAULT_DASHBOARD_ID,
		name: "Logs",
		description: "Volume, errors, latency and service health across your logs",
		icon: "ScrollText",
		order: 0,
		defaultTimeRange: "24h",
		// Sourced from the data rather than a fixed list, so these stay correct
		// as services and projects come and go.
		variables: [
			{
				name: "service",
				label: "Service",
				type: "select",
				optionsSql:
					"SELECT DISTINCT service AS value FROM logs WHERE service IS NOT NULL ORDER BY service LIMIT 200",
				includeAll: true,
			},
			{
				name: "project",
				label: "Project",
				type: "select",
				optionsSql:
					"SELECT DISTINCT project AS value FROM logs WHERE project IS NOT NULL ORDER BY project LIMIT 200",
				includeAll: true,
			},
		],
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
	{
		id: "analytics",
		name: "Web Analytics",
		description: "Traffic, sources, and audience for sites tracked by relog",
		icon: "TrendingUp",
		order: 1,
		defaultTimeRange: "7d",
		variables: [
			{
				name: "site",
				label: "Site",
				type: "select",
				// Rollups rather than raw events: they outlive raw retention, so the
				// picker keeps listing a site whose raw rows have aged out.
				optionsSql: "SELECT DISTINCT site AS value FROM event_rollups ORDER BY site LIMIT 200",
				includeAll: true,
			},
			{
				name: "device",
				label: "Device",
				type: "select",
				options: [
					{ label: "Desktop", value: "desktop" },
					{ label: "Mobile", value: "mobile" },
					{ label: "Tablet", value: "tablet" },
				],
				includeAll: true,
			},
		],
		createdAt: BUILTIN_TS,
		updatedAt: BUILTIN_TS,
		builtin: true,
	},
];
