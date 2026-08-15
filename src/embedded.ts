import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A standalone binary cannot ship a directory. Native addons and the web UI
 * are therefore concatenated into a single zstd-compressed blob, embedded as
 * one asset, and unpacked to a content-addressed cache directory the first
 * time they are needed.
 */
export type BundleIndex = Array<[name: string, offset: number, length: number]>;

/**
 * Write `bytes` to `dest` atomically. Two relog processes starting at once
 * would otherwise race on a half-written 100MB dylib and dlopen a truncated
 * file, so every file lands via a private temp name and a rename.
 */
function materialize(dest: string, bytes: Uint8Array): void {
	if (existsSync(dest)) return;
	mkdirSync(dirname(dest), { recursive: true });
	const tmp = `${dest}.${process.pid}.tmp`;
	writeFileSync(tmp, bytes);
	renameSync(tmp, dest);
}

/**
 * Unpack an embedded bundle into `dir` and return `dir`.
 *
 * `dir` must be content-addressed by the caller: the marker file makes repeat
 * launches free, and a new build writes to a new directory rather than mixing
 * old and new files in place.
 */
export function unpackBundle(blobPath: string, index: BundleIndex, dir: string): string {
	return unpack(blobPath, index, dir, true);
}

/** Counterpart for binaries built with `--no-compress`. */
export function unpackBundleRaw(blobPath: string, index: BundleIndex, dir: string): string {
	return unpack(blobPath, index, dir, false);
}

function unpack(blobPath: string, index: BundleIndex, dir: string, compressed: boolean): string {
	const marker = join(dir, ".complete");
	if (existsSync(marker)) return dir;

	const raw = readFileSync(blobPath);
	const blob = compressed ? Bun.zstdDecompressSync(raw) : new Uint8Array(raw);
	for (const [name, offset, length] of index) {
		materialize(join(dir, name), blob.subarray(offset, offset + length));
	}
	writeFileSync(marker, "");
	return dir;
}
