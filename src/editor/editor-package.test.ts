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

  it("publishes the reader worker sub-entry from generated dist output", () => {
    const packageJson = readPackageJson();
    const workerExport = packageJson.exports?.["./reader/worker"];

    expect(workerExport).toEqual({
      types: "./dist/reader-worker.d.ts",
      import: "./dist/reader-worker.mjs",
    });
  });

  it("publishes the standalone editor stylesheet", () => {
    const packageJson = readPackageJson();
    const cssExport = packageJson.exports?.["./style.css"];

    expect(cssExport).toBe("./dist/editor.css");
  });

  it("preserves the extracted editor package scripts", () => {
    const packageJson = readPackageJson();

    expect(packageJson.name).toBe("@chaoxu/coflat-editor");
    expect(packageJson.packageManager).toBe("pnpm@10.33.0");
    expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.editor.json");
    expect(packageJson.scripts?.build).toContain("vite build --config vite.editor.config.ts");
    expect(packageJson.scripts?.typecheck).toBe("tsc --noEmit");
    expect(packageJson.scripts?.test).toBe("vitest run");
    expect(packageJson.scripts?.prepack).toBe("pnpm build && pnpm publint");
  });
});
