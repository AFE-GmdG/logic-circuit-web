import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    target: ["es2024"],
    outDir: "dist",
    emptyOutDir: true,
  },
  define: {
    "process.env.VERSION": JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
  ],
});
