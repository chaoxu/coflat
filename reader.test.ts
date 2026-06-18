import { describe, expect, it } from "vitest";

import {
  applySourceRangeAttrs,
  closestMathSourceCarrier,
  closestSourceRangeCarrier,
  isSourceRangeCarrier,
  parseSourceOffset,
  sourceRangeAttrs,
  sourceRangeFromDataset,
  sourceRangeFromElement,
  sourceRangeFromValues,
  type SourceRange,
} from "./reader";

describe("@chaoxu/coflat/reader public source-range helpers", () => {
  it("exposes source range parsing helpers", () => {
    const range: SourceRange | null = sourceRangeFromValues("3", "8");

    expect(range).toEqual({ from: 3, to: 8 });
    expect(parseSourceOffset("12px")).toBe(12);
    expect(sourceRangeFromValues("8", "3", { requirePositive: true })).toBeNull();
  });

  it("exposes dataset and element helpers for reader surfaces", () => {
    const outer = document.createElement("p");
    outer.dataset.sourceFrom = "5";
    outer.dataset.sourceTo = "15";
    const inner = document.createElement("span");
    outer.append(inner);

    expect(sourceRangeFromDataset(outer.dataset, "sourceFrom", "sourceTo")).toEqual({
      from: 5,
      to: 15,
    });
    expect(isSourceRangeCarrier(outer)).toBe(true);
    expect(sourceRangeFromElement(inner, { closest: true })).toEqual({ from: 5, to: 15 });
    expect(closestSourceRangeCarrier(inner)).toBe(outer);
  });

  it("exposes source range attribute writers", () => {
    const element = document.createElement("span");
    applySourceRangeAttrs(element, {
      sourceLine: 4,
      sourceRange: { from: 12, to: 18 },
    });

    expect(sourceRangeAttrs({ sourceLine: 4, sourceRange: { from: 12, to: 18 } })).toBe(
      ' data-source-line="4" data-source-from="12" data-source-to="18"',
    );
    expect(element.outerHTML).toBe(
      '<span data-source-line="4" data-source-from="12" data-source-to="18"></span>',
    );
  });

  it("exposes math source carrier lookup", () => {
    const math = document.createElement("span");
    math.dataset.math = "x^2";
    const child = document.createElement("span");
    math.append(child);

    expect(closestMathSourceCarrier(child)).toBe(math);
  });
});
