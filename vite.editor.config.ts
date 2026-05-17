import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import {
  EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES,
  isEditorBuildDependency,
  isEditorBundledDependency,
  isEditorExternalDependency,
  packageNameFromSpecifier,
} from "./scripts/editor-package-manifest.mjs";

function copyEditorCss(): Plugin {
  return {
    name: "copy-editor-css",
    closeBundle() {
      const katexCss = readFileSync("node_modules/katex/dist/katex.min.css", "utf8");
      const editorCss = readFileSync("src/editor/editor-theme.css", "utf8");
      writeFileSync("dist/editor.css", `${katexCss}\n${editorCss}`);
      cpSync("node_modules/katex/dist/fonts", "dist/fonts", { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    copyEditorCss(),
    // Run `npm run build:analyze` to generate dist/stats.html bundle treemap
    mode === "analyze" &&
      visualizer({
        filename: "dist/stats.html",
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: {
        editor: fileURLToPath(new URL("./editor.ts", import.meta.url)),
        reader: fileURLToPath(new URL("./reader.ts", import.meta.url)),
        "reader-worker": fileURLToPath(new URL("./reader-worker.ts", import.meta.url)),
        parse: fileURLToPath(new URL("./parse.ts", import.meta.url)),
        citeproc: fileURLToPath(new URL("./citeproc.ts", import.meta.url)),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rolldownOptions: {
      external: (id) => {
        if (id.includes("?inline") || id.endsWith(".css")) {
          return false;
        }

        const packageName = packageNameFromSpecifier(id);
        if (packageName && EDITOR_FORBIDDEN_EXTERNAL_DEPENDENCIES.includes(packageName)) {
          throw new Error(
            `The standalone editor build imported app-only dependency ${packageName}.`,
          );
        }

        if (packageName && !isEditorBuildDependency(id)) {
          throw new Error(
            `The standalone editor build imported ${packageName}, which is not listed in scripts/editor-package-manifest.mjs.`,
          );
        }

        if (isEditorBundledDependency(id)) {
          return false;
        }

        return isEditorExternalDependency(id);
      },
      output: {
        // Keep entries self-contained where possible; the only shared
        // module across `editor` and `citeproc` is small type-only code,
        // which is fine to live in a shared chunk if rolldown emits one.
        chunkFileNames: "shared/[name]-[hash].mjs",
      },
    },
  },
}));
