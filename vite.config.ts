import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/dist/**", "**/.context/**"] },
    proxy: {
      "/api": "http://127.0.0.1:4318",
      "/evidence": "http://127.0.0.1:4318",
    },
  },
  build: { outDir: "dist/web" },
});
