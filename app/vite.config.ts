import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			"/health": "http://localhost:3485",
			"/histogram": "http://localhost:3485",
			"/ingest": "http://localhost:3485",
			"/logs": "http://localhost:3485",
			"/traces": "http://localhost:3485",
			"/query": "http://localhost:3485",
			"/stream": "http://localhost:3485",
			"/prune": "http://localhost:3485",
			"/archive": "http://localhost:3485",
			"/aggregates": "http://localhost:3485",
			"/widgets": "http://localhost:3485",
			"/dashboards": "http://localhost:3485",
			"/collect": "http://localhost:3485",
			"/analytics": "http://localhost:3485",
			"/script.js": "http://localhost:3485",
			"/v1": "http://localhost:3485",
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.vitest.{ts,tsx}"],
		css: false,
	},
});
