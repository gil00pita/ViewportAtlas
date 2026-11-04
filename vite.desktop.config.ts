import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()], base: "./",
  build: { outDir: "dist/desktop", rollupOptions: { input: resolve(import.meta.dirname, "desktop.html") } },
});
