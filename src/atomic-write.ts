import { promises as fs } from "node:fs";
import { dirname, basename } from "node:path";

/**
 * Write a file atomically: write to a temp sibling, fsync, then rename onto
 * the target. POSIX rename(2) within the same filesystem is atomic, so a
 * crash mid-write either leaves the previous content intact or fully
 * replaces it — never a half-written, parse-broken file. Without this, a
 * crash during a JSON write can corrupt the persisted state and the next
 * startup falls back to seeded defaults, silently destroying user data.
 */
export async function atomicWriteFile(target: string, data: string): Promise<void> {
	const dir = dirname(target);
	const tmp = `${dir}/.${basename(target)}.${process.pid}.${Date.now()}.tmp`;
	const handle = await fs.open(tmp, "w");
	try {
		await handle.writeFile(data);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await fs.rename(tmp, target);
	} catch (err) {
		// Best-effort cleanup of orphaned tmp file on rename failure.
		await fs.unlink(tmp).catch(() => {});
		throw err;
	}
}
