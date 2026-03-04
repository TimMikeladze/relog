export function parseMeta(raw: unknown): Record<string, unknown> | undefined {
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return { _raw: raw };
		}
	}
	return raw as Record<string, unknown> | undefined;
}
