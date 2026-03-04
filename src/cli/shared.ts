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

export function escapeCsv(value: unknown): string {
	const str = String(value ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}
