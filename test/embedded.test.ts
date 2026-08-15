import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type BundleIndex, unpackBundle, unpackBundleRaw } from "../src/embedded.ts";

let work: string;

/** Build the same blob + index layout that scripts/build-binary.ts emits. */
function pack(files: Record<string, string>): { blob: Uint8Array; index: BundleIndex } {
	const index: BundleIndex = [];
	const parts: Uint8Array[] = [];
	let offset = 0;
	for (const [name, contents] of Object.entries(files)) {
		const bytes = new TextEncoder().encode(contents);
		index.push([name, offset, bytes.length]);
		parts.push(bytes);
		offset += bytes.length;
	}
	const blob = new Uint8Array(offset);
	let cursor = 0;
	for (const part of parts) {
		blob.set(part, cursor);
		cursor += part.length;
	}
	return { blob, index };
}

beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "relog-embedded-"));
});

afterEach(() => {
	rmSync(work, { recursive: true, force: true });
});

describe("unpackBundle", () => {
	const FILES = {
		"index.html": "<!doctype html><title>relog</title>",
		"assets/app.js": "console.log('hi')",
		"assets/nested/deep.css": "body{}",
	};

	test("writes every file, including nested paths", () => {
		const { blob, index } = pack(FILES);
		const blobPath = join(work, "ui.blob");
		writeFileSync(blobPath, Bun.zstdCompressSync(blob));

		const out = unpackBundle(blobPath, index, join(work, "out"));

		for (const [name, contents] of Object.entries(FILES)) {
			expect(readFileSync(join(out, name), "utf-8")).toBe(contents);
		}
	});

	test("skips work on the second call via the completion marker", () => {
		const { blob, index } = pack(FILES);
		const blobPath = join(work, "ui.blob");
		writeFileSync(blobPath, Bun.zstdCompressSync(blob));
		const dir = join(work, "out");

		unpackBundle(blobPath, index, dir);
		expect(existsSync(join(dir, ".complete"))).toBe(true);

		// A missing blob would throw if the second call re-read it.
		rmSync(blobPath);
		expect(unpackBundle(blobPath, index, dir)).toBe(dir);
	});

	test("leaves no temp files behind", () => {
		const { blob, index } = pack(FILES);
		const blobPath = join(work, "ui.blob");
		writeFileSync(blobPath, Bun.zstdCompressSync(blob));

		const out = unpackBundle(blobPath, index, join(work, "out"));

		expect(existsSync(join(out, `index.html.${process.pid}.tmp`))).toBe(false);
	});
});

describe("unpackBundleRaw", () => {
	test("reads an uncompressed blob", () => {
		const { blob, index } = pack({ "a.txt": "alpha", "b.txt": "beta" });
		const blobPath = join(work, "raw.blob");
		writeFileSync(blobPath, blob);

		const out = unpackBundleRaw(blobPath, index, join(work, "out"));

		expect(readFileSync(join(out, "a.txt"), "utf-8")).toBe("alpha");
		expect(readFileSync(join(out, "b.txt"), "utf-8")).toBe("beta");
	});
});
