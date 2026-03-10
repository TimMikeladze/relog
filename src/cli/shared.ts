export function resolveAuth(explicit?: string): string | undefined {
	return explicit ?? process.env.RELOG_AUTH;
}

export function resolveAuthHeader(auth?: string): Record<string, string> {
	const resolved = resolveAuth(auth);
	if (resolved) {
		return { Authorization: `Bearer ${resolved}` };
	}
	return {};
}

export function authHeaders(auth?: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...resolveAuthHeader(auth),
	};
}

export function buildParams(values: Record<string, string | number | undefined>): URLSearchParams {
	const params = new URLSearchParams();
	for (const [key, val] of Object.entries(values)) {
		if (val !== undefined) params.set(key, String(val));
	}
	return params;
}

export function parseSize(s: string): number {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i);
	if (!match) {
		const n = Number(s);
		if (Number.isNaN(n)) throw new Error(`Invalid size: ${s}`);
		return n;
	}
	const value = Number.parseFloat(match[1]!);
	const unit = match[2]!.toLowerCase();
	const multipliers: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
	return Math.floor(value * multipliers[unit]!);
}

export function escapeCsv(value: unknown): string {
	const str = String(value ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}
