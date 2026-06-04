import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer build only. The Electron main + preload processes are bundled
// separately with esbuild (see scripts/build-main.mjs), per the C.A.D.S. spec
// tech stack: "Vite (renderer) + esbuild (main process)".
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
