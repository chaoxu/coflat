import { defineConfig } from "vite";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  root: "examples/simple",
  base: repository ? `/${repository}/` : "/",
  build: {
    outDir: "../../dist-pages",
    emptyOutDir: true,
  },
});
