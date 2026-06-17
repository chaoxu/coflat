import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageExport {
  readonly import?: string;
  readonly types?: string;
}

interface PackageManifest {
  readonly exports?: Record<string, PackageExport | string>;
  readonly files?: readonly string[];
  readonly name?: string;
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
}

function readPackageJson(): PackageManifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ) as PackageManifest;
}

describe("package editor export", () => {
  it("keeps the public package surface explicit", () => {
    const packageJson = readPackageJson();

    expect(Object.keys(packageJson.exports ?? {}).sort()).toEqual([
      ".",
      "./citeproc",
      "./latex",
      "./latex/filter.lua",
      "./latex/syntax-manifest.lua",
      "./latex/template/article.tex",
      "./latex/template/lipics.tex",
      "./numeric",
      "./parse",
      "./reader",
      "./reader/worker",
      "./style.css",
      "./test-utils",
      "./themes/blueprint-book.css",
    ]);
  });

  it("publishes the standalone editor from generated dist output", () => {
    const packageJson = readPackageJson();
    const editorExport = packageJson.exports?.["."];

    expect(editorExport).toEqual({
      types: "./dist/editor.d.ts",
      import: "./dist/editor.mjs",
    });
    expect(packageJson.files).toContain("dist");
  });

  it("publishes the citeproc sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const citeprocExport = packageJson.exports?.["./citeproc"];

    expect(citeprocExport).toEqual({
      types: "./dist/citeproc.d.ts",
      import: "./dist/citeproc.mjs",
    });
  });

  it("publishes the reader sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const readerExport = packageJson.exports?.["./reader"];

    expect(readerExport).toEqual({
      types: "./dist/reader.d.ts",
      import: "./dist/reader.mjs",
    });
  });

  it("publishes the reader worker sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const workerExport = packageJson.exports?.["./reader/worker"];

    expect(workerExport).toEqual({
      types: "./dist/reader-worker.d.ts",
      import: "./dist/reader-worker.mjs",
    });
  });

  it("publishes the parse sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const parseExport = packageJson.exports?.["./parse"];

    expect(parseExport).toEqual({
      types: "./dist/parse.d.ts",
      import: "./dist/parse.mjs",
    });
  });

  it("publishes the numeric citation helper sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const numericExport = packageJson.exports?.["./numeric"];

    expect(numericExport).toEqual({
      types: "./dist/numeric.d.ts",
      import: "./dist/numeric.mjs",
    });
  });

  it("publishes the latex export contract and bundled assets", () => {
    const packageJson = readPackageJson();
    const latexExport = packageJson.exports?.["./latex"];

    expect(latexExport).toEqual({
      types: "./dist/latex.d.ts",
      import: "./dist/latex.mjs",
    });
    expect(packageJson.exports?.["./latex/filter.lua"]).toBe("./dist/latex/filter.lua");
    expect(packageJson.exports?.["./latex/syntax-manifest.lua"]).toBe("./dist/latex/syntax-manifest.lua");
    expect(packageJson.exports?.["./latex/template/article.tex"]).toBe("./dist/latex/template/article.tex");
    expect(packageJson.exports?.["./latex/template/lipics.tex"]).toBe("./dist/latex/template/lipics.tex");
  });

  it("publishes test helpers from a top-level generated test-utils entry", () => {
    const packageJson = readPackageJson();
    const testUtilsExport = packageJson.exports?.["./test-utils"];

    expect(testUtilsExport).toEqual({
      types: "./dist/test-utils.d.ts",
      import: "./dist/test-utils.js",
    });
  });

  it("publishes the standalone editor stylesheet", () => {
    const packageJson = readPackageJson();
    const cssExport = packageJson.exports?.["./style.css"];

    expect(cssExport).toBe("./dist/editor.css");
  });

  it("publishes optional theme stylesheets as explicit subpath exports", () => {
    const packageJson = readPackageJson();

    expect(packageJson.exports?.["./themes/blueprint-book.css"]).toBe(
      "./dist/themes/blueprint-book.css",
    );
  });

  it("preserves the extracted editor package scripts", () => {
    const packageJson = readPackageJson();

    expect(packageJson.name).toBe("@chaoxu/coflat");
    expect(packageJson.packageManager).toBe("pnpm@10.33.0");
    expect(packageJson.scripts?.build).toContain("rm -rf dist");
    expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.editor.json");
    expect(packageJson.scripts?.build).toContain("vite build --config vite.editor.config.ts");
    expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.test-utils.json");
    expect(packageJson.scripts?.build).not.toContain("cp src/editor/test-utils.ts");
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts?.test).toBe("vitest run");
    expect(packageJson.scripts?.prepack).toBe("pnpm build && pnpm publint");
  });
});
