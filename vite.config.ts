import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": r("./src/shared"),
      "@pipeline": r("./src/pipeline"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: r("./dist/client"),
    emptyOutDir: true,
  },
});
