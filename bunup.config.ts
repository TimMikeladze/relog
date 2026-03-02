import { defineWorkspace } from "bunup";

export default defineWorkspace([
	{
		name: "server",
		root: "packages/server",
		entry: {
			index: "src/index.ts",
			cli: "src/cli.ts",
		},
		dts: true,
		target: "node",
		external: ["bun:sqlite"],
	},
	{
		name: "client",
		root: "packages/client",
		dts: true,
		target: "node",
	},
]);
