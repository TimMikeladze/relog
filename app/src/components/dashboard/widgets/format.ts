export type ValueFormat = "number" | "bytes" | "ms" | "percent" | "timestamp";

export function formatValue(v: unknown, fmt: ValueFormat | undefined): string {
	if (v == null) return "—";
	const n = typeof v === "number" ? v : Number(v);
	if (!fmt || fmt === "number") {
		if (!Number.isFinite(n)) return String(v);
		return n.toLocaleString();
	}
	if (fmt === "bytes") {
		if (!Number.isFinite(n)) return String(v);
		if (n < 1024) return `${n} B`;
		if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
		if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
		return `${(n / 1024 ** 3).toFixed(2)} GB`;
	}
	if (fmt === "ms") {
		if (!Number.isFinite(n)) return String(v);
		if (n < 1) return `${n.toFixed(2)} ms`;
		if (n < 1000) return `${n.toFixed(1)} ms`;
		return `${(n / 1000).toFixed(2)} s`;
	}
	if (fmt === "percent") {
		if (!Number.isFinite(n)) return String(v);
		return `${n.toFixed(2)}%`;
	}
	if (fmt === "timestamp") {
		const d = typeof v === "string" ? new Date(v) : new Date(n);
		return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-US", { hour12: false });
	}
	return String(v);
}
