import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
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
      mkdirSync("dist/themes", { recursive: true });
      cpSync("src/themes/blueprint-book.css", "dist/themes/blueprint-book.css");
      cpSync("node_modules/katex/dist/fonts", "dist/fonts", { recursive: true });
      mkdirSync("dist/latex/template", { recursive: true });
      cpSync("src/editor/latex/filter.lua", "dist/latex/filter.lua");
      cpSync("src/editor/latex/syntax-manifest.lua", "dist/latex/syntax-manifest.lua");
      cpSync("src/editor/latex/template/article.tex", "dist/latex/template/article.tex");
      cpSync("src/editor/latex/template/lipics.tex", "dist/latex/template/lipics.tex");
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    copyEditorCss(),
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
        numeric: fileURLToPath(new URL("./numeric.ts", import.meta.url)),
        latex: fileURLToPath(new URL("./latex.ts", import.meta.url)),
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
