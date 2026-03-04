import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts", "src/client.ts", "src/mcp.ts", "src/next.ts"],
	dts: true,
	target: "node",
	external: ["bun:sqlite"],
});
