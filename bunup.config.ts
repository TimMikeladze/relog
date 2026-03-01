import { defineWorkspace } from "bunup";

// https://bunup.dev/docs/guide/workspaces

export default defineWorkspace([
	{
		name: "server",
		root: "packages/server",
	},
]);
