import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		proxy: {
			"/health": "http://localhost:3485",
			"/histogram": "http://localhost:3485",
			"/ingest": "http://localhost:3485",
			"/logs": "http://localhost:3485",
			"/query": "http://localhost:3485",
			"/stream": "http://localhost:3485",
			"/prune": "http://localhost:3485",
			"/archive": "http://localhost:3485",
			"/aggregates": "http://localhost:3485",
		},
	},
});
