export function resolveAuth(explicit?: string): string | undefined {
	return explicit ?? process.env.RELOG_AUTH;
}

/**
 * `fetch` against a relog server, with a diagnosis instead of a stack trace
 * when nothing answers.
 *
 * Bun raises "Unable to connect. Is the computer able to access the url?" for
 * every transport failure — a refused port and an unresolvable host both
 * arrive as `code: "ConnectionRefused"` — so the code is no use for telling
 * them apart. What the reader actually needs is the address that was tried and
 * the fact that a server has to be running at it, which reads as a network
 * fault otherwise.
 *
 * Only for one-shot commands that should stop on a failed connection. `tail`
 * and `seed` reconnect on purpose and handle their own errors.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(url, init);
	} catch (err) {
		let origin: string;
		try {
			origin = new URL(url).origin;
		} catch {
			origin = url;
		}
		console.error(`Cannot reach a relog.sh server at ${origin}`);
		console.error(`  ${(err as Error).message}`);
		console.error("");
		console.error("Start one with `relog start`, or pass --url if it listens elsewhere.");
		process.exit(1);
	}
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
