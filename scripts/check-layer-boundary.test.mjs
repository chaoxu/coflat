import { describe, expect, it } from "vitest";

import { checkSource } from "./check-layer-boundary.mjs";

describe("check-layer-boundary re-export detection", () => {
  it("flags `export … from` re-exports of forbidden packages in core/", () => {
    const cases = [
      'export { EditorState } from "@codemirror/state";',
      'export * from "@codemirror/view";',
      'export * as ns from "react";',
      'export type { Foo } from "react-dom";',
    ];
    for (const src of cases) {
      const violations = checkSource(src, "core", "/repo/src/core/x.ts");
      expect(violations, src).not.toHaveLength(0);
    }
  });

  it("does not treat `export const x = \"pkg\"` as an import", () => {
    const src = 'export const KATEX = "katex";\nexport const cls = "react-dom";';
    expect(checkSource(src, "core", "/repo/src/core/x.ts")).toHaveLength(0);
  });

  it("leaves an allowed package re-export in the reader layer alone", () => {
    // @lezer/common is not on the reader forbidden list; a re-export of it
    // must not be flagged (guards against the new regex over-matching).
    const src = 'export type { Tree } from "@lezer/common";';
    expect(checkSource(src, "reader", "/repo/src/reader/x.ts")).toHaveLength(0);
  });
});
