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

function safeEquals(a: string, b: string): boolean {
	return timingSafeEqual(sha256(a), sha256(b));
}

function resolveRole(token: string, keys: AuthKeys): Role | null {
	if (keys.adminKeys?.some((k) => safeEquals(token, k))) return "admin";
	if (keys.readKeys?.some((k) => safeEquals(token, k))) return "read";
	if (keys.ingestKeys?.some((k) => safeEquals(token, k))) return "ingest";
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
