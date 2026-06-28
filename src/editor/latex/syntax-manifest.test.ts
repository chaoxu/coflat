import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BLOCK_MANIFEST_ENTRIES } from "../../core/constants/block-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_MANIFEST = readFileSync(resolve(__dirname, "syntax-manifest.lua"), "utf8");

const LATEX_KIND_BY_BLOCK: Readonly<Record<string, string>> = {
  algorithm: "algorithm",
  blockquote: "blockquote",
  figure: "figure",
  table: "table",
};

function readLuaTableBody(name: string): string {
  const match = LUA_MANIFEST.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n  \\}`, "u"));
  if (!match) {
    throw new Error(`Missing Lua table ${name}`);
  }
  return match[1];
}

function readLuaStringMap(name: string): Record<string, string> {
  const body = readLuaTableBody(name);
  return Object.fromEntries(
    [...body.matchAll(/([A-Za-z_][\w]*)\s*=\s*"([^"]+)"/gu)]
      .map((match) => [match[1], match[2]]),
  );
}

describe("LaTeX syntax manifest", () => {
  it("keeps LaTeX block kinds synchronized with the TypeScript manifest", () => {
    const expected = Object.fromEntries(
      BLOCK_MANIFEST_ENTRIES
        .filter((entry) => entry.latexExportKind !== "none")
        .map((entry) => [
          entry.name,
          entry.latexExportKind ?? LATEX_KIND_BY_BLOCK[entry.name] ?? "environment",
        ]),
    );
    expect(readLuaStringMap("latex_kind_by_block")).toEqual(expected);
  });

  it("keeps LaTeX environments synchronized with the TypeScript manifest", () => {
    const expected = Object.fromEntries(
      BLOCK_MANIFEST_ENTRIES
        .filter((entry) => (entry.latexExportKind ?? LATEX_KIND_BY_BLOCK[entry.name] ?? "environment") === "environment")
        .map((entry) => [entry.name, entry.latexEnvironment ?? entry.name]),
    );

    expect(readLuaStringMap("latex_environment_by_block")).toEqual(expected);
  });
});
