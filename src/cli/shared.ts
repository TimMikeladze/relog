export function resolveAuth(explicit?: string): string | undefined {
	return explicit ?? process.env.RELOG_AUTH;
}

export function authHeaders(auth?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	const resolved = resolveAuth(auth);
	if (resolved) {
		headers["Authorization"] = `Basic ${Buffer.from(resolved).toString("base64")}`;
	}
	return headers;
}

export function escapeCsv(value: unknown): string {
	const str = String(value ?? "");
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}
