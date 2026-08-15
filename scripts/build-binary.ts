#!/usr/bin/env bun
/**
 * Build standalone relog binaries.
 *
 *   bun run build:bin                      # host platform -> bin/relog
 *   bun run build:bin --target linux-x64   # cross-compile
 *   bun run build:bin --all                # every supported target
 *
 * A relog binary has to carry two things Bun's `--compile` will not embed on
 * its own:
 *
 *  1. DuckDB's native addon. `@duckdb/node-bindings` requires one of eight
 *     platform packages behind a `switch`, which the bundler tries to resolve
 *     for *every* branch, and the addon dlopens a sibling `libduckdb` via
 *     `@loader_path` that Bun's own .node extraction leaves behind. Both are
 *     solved by aliasing `@duckdb/node-bindings` to a generated shim that
 *     unpacks addon + library side by side and requires the result.
 *
 *  2. The web UI. `app/dist` is a directory tree; binaries get a single
 *     concatenated, zstd-compressed blob unpacked on first use.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { BundleIndex } from "../src/embedded.ts";

const ROOT = resolve(import.meta.dir, "..");
const BUILD_DIR = join(ROOT, ".build");
const OUT_DIR = join(ROOT, "bin");
const APP_DIST = join(ROOT, "app", "dist");

interface Target {
	/** Value for Bun's --target flag. */
	bun: Bun.Build.CompileTarget;
	/** Platform suffix of the matching @duckdb/node-bindings-* package. */
	duckdb: string;
	exe?: string;
}

const TARGETS: Record<string, Target | undefined> = {
	"darwin-arm64": { bun: "bun-darwin-arm64", duckdb: "darwin-arm64" },
	"darwin-x64": { bun: "bun-darwin-x64", duckdb: "darwin-x64" },
	"linux-x64": { bun: "bun-linux-x64", duckdb: "linux-x64" },
	"linux-arm64": { bun: "bun-linux-arm64", duckdb: "linux-arm64" },
	"windows-x64": { bun: "bun-windows-x64", duckdb: "win32-x64", exe: ".exe" },
};

const HOST = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;

// --- argument parsing ---

interface Options {
	targets: string[];
	skipApp: boolean;
	compressLevel: number;
}

function parseArgs(argv: string[]): Options {
	const targets: string[] = [];
	let skipApp = false;
	let compressLevel = 10;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] as string;
		if (arg === "--all") {
			targets.push(...Object.keys(TARGETS));
		} else if (arg === "--target" || arg === "-t") {
			const value = argv[++i];
			if (!value) fail("--target requires a value");
			targets.push(...value.split(",").map((t) => t.trim()));
		} else if (arg.startsWith("--target=")) {
			targets.push(
				...arg
					.slice("--target=".length)
					.split(",")
					.map((t) => t.trim()),
			);
		} else if (arg === "--skip-app") {
			skipApp = true;
		} else if (arg === "--no-compress") {
			compressLevel = 0;
		} else if (arg === "--help" || arg === "-h") {
			usage();
			process.exit(0);
		} else {
			fail(`unknown flag: ${arg}`);
		}
	}

	const unique = [...new Set(targets.length > 0 ? targets : [HOST])];
	for (const name of unique) resolveTarget(name);
	return { targets: unique, skipApp, compressLevel };
}

function usage(): void {
	console.log(`relog binary builder

  bun run build:bin [options]

Options:
  -t, --target <t[,t]>  Target platform(s): ${Object.keys(TARGETS).join(", ")}
      --all             Build every supported target
      --skip-app        Reuse an existing app/dist instead of rebuilding the UI
      --no-compress     Embed assets uncompressed (faster build, ~4x larger binary)
  -h, --help            Show this message`);
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

function resolveTarget(name: string): Target {
	const target = TARGETS[name];
	if (!target) fail(`unsupported target "${name}" (known: ${Object.keys(TARGETS).join(", ")})`);
	return target;
}

// --- helpers ---

function human(bytes: number): string {
	return `${(bytes / 1_000_000).toFixed(1)}MB`;
}

async function sh(cmd: string[], cwd: string): Promise<void> {
	const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
	const code = await proc.exited;
	if (code !== 0) fail(`\`${cmd.join(" ")}\` exited with ${code}`);
}

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...walk(path));
		else out.push(path);
	}
	return out;
}

/**
 * Pack files into one buffer plus an index of offsets. Returns the blob path
 * and a short content hash used to key the runtime cache directory, so a
 * rebuilt binary never reuses a previous build's unpacked files.
 */
async function packBundle(
	files: Array<{ name: string; path: string }>,
	outfile: string,
	compressLevel: number,
): Promise<{ index: BundleIndex; hash: string; size: number }> {
	const index: BundleIndex = [];
	const chunks: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const bytes = new Uint8Array(readFileSync(file.path));
		index.push([file.name, offset, bytes.length]);
		chunks.push(bytes);
		offset += bytes.length;
	}

	const blob = new Uint8Array(offset);
	let cursor = 0;
	for (const chunk of chunks) {
		blob.set(chunk, cursor);
		cursor += chunk.length;
	}

	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(blob);
	const hash = hasher.digest("hex").slice(0, 16);

	const payload = compressLevel > 0 ? Bun.zstdCompressSync(blob, { level: compressLevel }) : blob;
	await Bun.write(outfile, payload);
	return { index, hash, size: payload.length };
}

/**
 * `unpackBundle` is a no-op when the blob is stored uncompressed, so the
 * generated code needs the matching reader. Keeping both paths here (rather
 * than sniffing the zstd magic at runtime) keeps `src/embedded.ts` free of
 * build-mode branching.
 */
function bundleReader(compressLevel: number): string {
	return compressLevel > 0 ? "unpackBundle" : "unpackBundleRaw";
}

// --- DuckDB bindings ---

const BINDING_SKIP = new Set(["package.json", "README.md", "LICENSE"]);

function duckdbVersion(): string {
	const pkg = join(ROOT, "node_modules", "@duckdb", "node-bindings", "package.json");
	if (!existsSync(pkg)) fail("@duckdb/node-bindings is not installed — run `bun install` first");
	return JSON.parse(readFileSync(pkg, "utf-8")).version;
}

/**
 * Resolve the directory holding a target's DuckDB addon. Platform packages
 * declare `os`/`cpu`, so `bun install` only ever fetches the host's — every
 * other target is downloaded straight from the registry and cached.
 */
async function bindingDir(platform: string, version: string): Promise<string> {
	const local = join(ROOT, "node_modules", "@duckdb", `node-bindings-${platform}`);
	if (existsSync(join(local, "duckdb.node"))) return local;

	const cached = join(BUILD_DIR, "bindings", `${platform}-${version}`);
	if (existsSync(join(cached, "duckdb.node"))) return cached;

	const name = `@duckdb/node-bindings-${platform}`;
	console.log(`  fetching ${name}@${version}`);
	const meta = await fetch(`https://registry.npmjs.org/${name}/${version}`);
	if (!meta.ok) fail(`could not fetch ${name}@${version}: HTTP ${meta.status}`);
	const tarball = (await meta.json()).dist?.tarball;
	if (!tarball) fail(`registry entry for ${name}@${version} has no tarball`);

	const tgz = join(BUILD_DIR, "bindings", `${platform}-${version}.tgz`);
	const res = await fetch(tarball);
	if (!res.ok) fail(`could not download ${tarball}: HTTP ${res.status}`);
	await Bun.write(tgz, res);

	mkdirSync(cached, { recursive: true });
	// npm tarballs nest everything under package/
	await sh(["tar", "-xzf", tgz, "-C", cached, "--strip-components=1"], ROOT);
	rmSync(tgz, { force: true });

	if (!existsSync(join(cached, "duckdb.node"))) fail(`${name}@${version} contained no duckdb.node`);
	return cached;
}

// --- build ---

async function buildTarget(name: string, options: Options, version: string): Promise<void> {
	const target = resolveTarget(name);
	const gen = join(BUILD_DIR, "gen", name);
	rmSync(gen, { recursive: true, force: true });
	mkdirSync(gen, { recursive: true });

	console.log(`\n${name}`);

	// 1. DuckDB addon + its shared library, packed side by side. The addon
	//    resolves the library through @loader_path, so they must unpack into
	//    the same directory.
	const duckdbVer = duckdbVersion();
	const bindings = await bindingDir(target.duckdb, duckdbVer);
	const nativeFiles = readdirSync(bindings)
		.filter((f) => !BINDING_SKIP.has(f))
		.map((f) => ({ name: f, path: join(bindings, f) }));
	const native = await packBundle(nativeFiles, join(gen, "duckdb.blob"), options.compressLevel);
	console.log(`  duckdb ${duckdbVer}: ${nativeFiles.length} files -> ${human(native.size)}`);

	// 2. The web UI.
	const uiFiles = walk(APP_DIST).map((path) => ({
		name: relative(APP_DIST, path),
		path,
	}));
	const ui = await packBundle(uiFiles, join(gen, "ui.blob"), options.compressLevel);
	console.log(`  ui: ${uiFiles.length} files -> ${human(ui.size)}`);

	const read = bundleReader(options.compressLevel);
	const src = (file: string) => JSON.stringify(join(ROOT, "src", file));

	// The shim stands in for @duckdb/node-bindings, whose only job is to
	// `require` the right platform addon. Everything is synchronous because
	// @duckdb/node-api requires it during module evaluation.
	await Bun.write(
		join(gen, "duckdb-shim.ts"),
		`import { createRequire } from "node:module";
import { join } from "node:path";
import blob from ${JSON.stringify(join(gen, "duckdb.blob"))} with { type: "file" };
import { ${read} } from ${src("embedded.ts")};
import { getDataDir } from ${src("paths.ts")};

const dir = ${read}(blob, ${JSON.stringify(native.index)}, join(getDataDir(), "native", "duckdb-${duckdbVer}-${native.hash}"));
export default createRequire(import.meta.url)(join(dir, "duckdb.node"));
`,
	);

	await Bun.write(
		join(gen, "entry.ts"),
		`import { join } from "node:path";
import uiBlob from ${JSON.stringify(join(gen, "ui.blob"))} with { type: "file" };
import { ${read} } from ${src("embedded.ts")};
import { getDataDir, setAppDistResolver } from ${src("paths.ts")};

const UI_INDEX = ${JSON.stringify(ui.index)};

setAppDistResolver(() =>
	${read}(uiBlob, UI_INDEX, join(getDataDir(), "ui", ${JSON.stringify(ui.hash)})),
);

await import(${src("cli.ts")});
`,
	);

	const outfile = join(OUT_DIR, `relog-${name}${target.exe ?? ""}`);
	const result = await Bun.build({
		entrypoints: [join(gen, "entry.ts")],
		target: "bun",
		compile: { target: target.bun, outfile },
		// Identifiers are preserved deliberately: src/db/duckdb.ts detects
		// DuckDB value classes by constructor name, which mangling destroys.
		minify: { whitespace: true, syntax: true, identifiers: false },
		define: { "process.env.RELOG_VERSION": JSON.stringify(version) },
		plugins: [
			{
				name: "duckdb-bindings-alias",
				setup(build) {
					build.onResolve({ filter: /^@duckdb\/node-bindings$/ }, () => ({
						path: join(gen, "duckdb-shim.ts"),
					}));
				},
			},
		],
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		fail(`build failed for ${name}`);
	}

	await adhocSign(name, outfile);

	console.log(`  -> ${relative(ROOT, outfile)} (${human(statSync(outfile).size)})`);
}

/**
 * Re-sign macOS output, which `codesign -v` otherwise reports as "code or
 * signature have been modified": compiling appends the standalone payload
 * after Bun has already signed the executable.
 *
 * An arm64 binary in that state is at the kernel's mercy — it usually runs,
 * but it can also be SIGKILLed before `main` (exit 137, no diagnostic), which
 * reads as a corrupt download rather than a signing problem. An ad-hoc
 * signature costs nothing here and makes the outcome deterministic.
 *
 * codesign only exists on macOS, so a Mac binary cross-built elsewhere keeps
 * the invalid signature and has to be signed on arrival.
 */
async function adhocSign(name: string, outfile: string): Promise<void> {
	if (!name.startsWith("darwin")) return;
	if (process.platform !== "darwin") {
		console.log("  ! unsigned (needs macOS) — run `codesign -s - --force` before distributing");
		return;
	}
	await sh(["codesign", "--sign", "-", "--force", outfile], ROOT);
}

// --- main ---

const options = parseArgs(process.argv.slice(2));
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;

if (!options.skipApp) {
	console.log("building web UI");
	await sh(["bun", "run", "build"], join(ROOT, "app"));
}
if (!existsSync(join(APP_DIST, "index.html"))) {
	fail("app/dist/index.html is missing — drop --skip-app to build the UI");
}

mkdirSync(OUT_DIR, { recursive: true });
for (const name of options.targets) await buildTarget(name, options, version);

if (options.targets.includes(HOST)) {
	const hostBinary = join(OUT_DIR, `relog-${HOST}${resolveTarget(HOST).exe ?? ""}`);
	await sh(["cp", hostBinary, join(OUT_DIR, "relog")], ROOT);
	console.log(`\nbin/relog -> relog-${HOST}`);
}

console.log("\ndone. try: ./bin/relog start");
