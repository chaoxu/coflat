import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Minimal dev-server config used only by the Playwright smoke harness.
// Reuses the React SWC plugin so the few .tsx files transitively reachable
// from the editor barrel parse correctly. No build output is produced here.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
});
