import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: "src/popup/index.html",
        options: "src/options/index.html",
        search: "src/search/index.html",
        sidepanel: "src/sidepanel/index.html",
      },
    },
  },
});
