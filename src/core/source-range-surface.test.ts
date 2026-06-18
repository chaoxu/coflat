import { describe, expect, it } from "vitest";
import {
  applySourceRangeAttrs,
  sourceRangeAttrs,
} from "./source-range-surface";

describe("source range surface", () => {
  it("serializes source line and source byte range attributes", () => {
    expect(sourceRangeAttrs({
      sourceLine: 3,
      sourceRange: { from: 10, to: 20 },
    })).toBe(' data-source-line="3" data-source-from="10" data-source-to="20"');
  });

  it("omits disabled source attributes", () => {
    expect(sourceRangeAttrs({})).toBe("");
    expect(sourceRangeAttrs({ sourceRange: null, sourceLine: null })).toBe("");
  });

  it("applies source line and byte range attributes to DOM elements", () => {
    const element = document.createElement("p");
    applySourceRangeAttrs(element, {
      sourceLine: 4,
      sourceRange: { from: 12, to: 18 },
    });
    expect(element.outerHTML).toBe('<p data-source-line="4" data-source-from="12" data-source-to="18"></p>');
  });
});
