import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { Widget, WidgetsFile } from "../types.ts";

export class WidgetsManager {
	private widgets: Map<string, Widget> = new Map();
	private filePath: string | null;

	constructor(filePath?: string) {
		this.filePath = filePath || null;
	}

	async init(): Promise<void> {
		for (const w of DEFAULT_WIDGETS) {
			this.widgets.set(w.id, w);
		}
		if (this.filePath) {
			try {
				const raw = await fs.readFile(this.filePath, "utf-8");
				const parsed = JSON.parse(raw) as WidgetsFile | Widget[];
				const list = Array.isArray(parsed) ? parsed : parsed.widgets;
				for (const w of list) {
					this.widgets.set(w.id, w);
				}
			} catch {
				// missing or invalid file — keep defaults
			}
		}
	}

	async add(widget: Omit<Widget, "createdAt" | "updatedAt">): Promise<Widget> {
		const now = Date.now();
		const w: Widget = { ...widget, createdAt: now, updatedAt: now };
		this.widgets.set(w.id, w);
		await this.persist();
		return w;
	}

	async update(
		id: string,
		updates: Partial<Omit<Widget, "id" | "createdAt">>,
	): Promise<Widget | null> {
		const existing = this.widgets.get(id);
		if (!existing) return null;
		const updated: Widget = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now(),
		};
		this.widgets.set(id, updated);
		await this.persist();
		return updated;
	}

	async delete(id: string): Promise<boolean> {
		const w = this.widgets.get(id);
		if (!w) return false;
		if (w.builtin) return false;
		this.widgets.delete(id);
		await this.persist();
		return true;
	}

	getAll(): Widget[] {
		return Array.from(this.widgets.values()).sort(
			(a, b) => a.createdAt - b.createdAt,
		);
	}

	get(id: string): Widget | null {
		return this.widgets.get(id) || null;
	}

	private async persist(): Promise<void> {
		if (!this.filePath) return;
		try {
			await fs.mkdir(dirname(this.filePath), { recursive: true });
			const body: WidgetsFile = {
				version: 1,
				widgets: Array.from(this.widgets.values()),
			};
			await fs.writeFile(this.filePath, JSON.stringify(body, null, 2));
		} catch (err) {
			console.error("[relog.dev] Failed to persist widgets:", err);
		}
	}
}

// Populated in Task 4. Placeholder so init() compiles.
export const DEFAULT_WIDGETS: Widget[] = [];
