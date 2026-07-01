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

const DOCUMENT_SURFACE_IMPORT = '@import "../core/document-surface.css";';

function inlineDocumentSurface(editorCss: string, documentSurfaceCss: string): string {
  if (!editorCss.includes(DOCUMENT_SURFACE_IMPORT)) {
    throw new Error(`src/editor/editor-theme.css must import ${DOCUMENT_SURFACE_IMPORT}`);
  }
  const inlined = editorCss.replace(DOCUMENT_SURFACE_IMPORT, documentSurfaceCss.trimEnd());
  if (inlined.includes(DOCUMENT_SURFACE_IMPORT)) {
    throw new Error("document surface CSS import was not fully inlined");
  }
  return inlined;
}

function copyEditorCss(): Plugin {
  return {
    name: "copy-editor-css",
    closeBundle() {
      const katexCss = readFileSync("node_modules/katex/dist/katex.min.css", "utf8");
      const documentSurfaceCss = readFileSync("src/core/document-surface.css", "utf8");
      const editorCss = readFileSync("src/editor/editor-theme.css", "utf8");
      const inlinedEditorCss = inlineDocumentSurface(editorCss, documentSurfaceCss);
      writeFileSync("dist/document-surface.css", `${katexCss}\n${documentSurfaceCss}`);
      writeFileSync("dist/editor.css", `${katexCss}\n${inlinedEditorCss}`);
      mkdirSync("dist/themes", { recursive: true });
      cpSync("src/themes/blueprint-book.css", "dist/themes/blueprint-book.css");
      cpSync("node_modules/katex/dist/fonts", "dist/fonts", { recursive: true });
      mkdirSync("dist/latex/csl", { recursive: true });
      mkdirSync("dist/latex/template", { recursive: true });
      cpSync("src/editor/citations/ieee.csl", "dist/latex/csl/ieee.csl");
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
        "inline-render": fileURLToPath(new URL("./inline-render.ts", import.meta.url)),
        reader: fileURLToPath(new URL("./reader.ts", import.meta.url)),
        "rich-readonly": fileURLToPath(new URL("./rich-readonly.ts", import.meta.url)),
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
