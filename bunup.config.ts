import { defineConfig } from "bunup";

export default defineConfig([
	{
		name: "node",
		entry: ["src/index.ts", "src/cli.ts", "src/client.ts", "src/mcp.ts", "src/next.ts"],
		dts: true,
		target: "bun",
		external: ["bun:sqlite"],
	},
	{
		name: "browser",
		entry: ["src/browser.ts"],
		dts: true,
		target: "browser",
	},
]);
