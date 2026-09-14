import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "github-pages",
  base: "/hengjian-review-score/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-github"),
    emptyOutDir: true,
  },
});

