import { defineConfig } from "vite";

// Minimal dev-server config used only by the Playwright smoke harness.
// Vite's esbuild transform is enough for the TS/TSX fixture graph here.
// No build output is produced here.
export default defineConfig({
  server: {
    port: 5180,
    strictPort: true,
  },
});
