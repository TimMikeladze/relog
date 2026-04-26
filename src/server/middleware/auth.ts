import { createHash, timingSafeEqual } from "node:crypto";

export type Role = "ingest" | "read" | "admin";

export interface AuthKeys {
	ingestKeys?: string[];
	readKeys?: string[];
	adminKeys?: string[];
}

const ROLE_HIERARCHY: Record<Role, Set<Role>> = {
	admin: new Set(["admin", "read", "ingest"]),
	read: new Set(["read", "ingest"]),
	ingest: new Set(["ingest"]),
};

function sha256(input: string): Buffer {
	return createHash("sha256").update(input).digest();
}

/**
 * Pre-hashed view of the configured keys. We compute SHA-256 once per
 * configured key when the request first arrives (memoized by AuthKeys
 * identity) so that each subsequent token check costs one hash of the
 * candidate plus N constant-time compares — not 1+N hashes per request.
 */
interface PrehashedKeys {
	admin: Buffer[];
	read: Buffer[];
	ingest: Buffer[];
}
const prehashCache = new WeakMap<AuthKeys, PrehashedKeys>();

function prehash(keys: AuthKeys): PrehashedKeys {
	let cached = prehashCache.get(keys);
	if (cached) return cached;
	cached = {
		admin: (keys.adminKeys ?? []).map(sha256),
		read: (keys.readKeys ?? []).map(sha256),
		ingest: (keys.ingestKeys ?? []).map(sha256),
	};
	prehashCache.set(keys, cached);
	return cached;
}

function matchesAny(candidate: Buffer, configured: Buffer[]): boolean {
	for (const k of configured) {
		if (k.length === candidate.length && timingSafeEqual(k, candidate)) return true;
	}
	return false;
}

function resolveRole(token: string, keys: AuthKeys): Role | null {
	const candidate = sha256(token);
	const ph = prehash(keys);
	if (matchesAny(candidate, ph.admin)) return "admin";
	if (matchesAny(candidate, ph.read)) return "read";
	if (matchesAny(candidate, ph.ingest)) return "ingest";
	return null;
}

export interface AuthResult {
	error?: Response;
	keyPrefix?: string;
}

export function checkRole(
	request: Request,
	requiredRole: Role,
	keys: AuthKeys,
	keyPrefixLength: number = 6,
): AuthResult {
	const hasAnyKey = keys.ingestKeys?.length || keys.readKeys?.length || keys.adminKeys?.length;
	if (!hasAnyKey) return {};

	const header = request.headers.get("Authorization");
	if (!header) {
		return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	}

	const match = header.match(/^Bearer\s+(.+)$/);
	if (!match) {
		return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	}

	const token = match[1]!;
	const role = resolveRole(token, keys);

	if (!role) {
		return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
	}

	if (!ROLE_HIERARCHY[role].has(requiredRole)) {
		return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
	}

	return { keyPrefix: token.slice(0, keyPrefixLength) };
}
