import { describe, expect, it } from "vitest";
import {
  applySourceRangeAttrs,
  parseSourceOffset,
  sourceRangeAttrs,
  sourceRangeFromDataset,
  sourceRangeFromElement,
  sourceRangeFromValues,
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

  it("parses source offsets from attribute values", () => {
    expect(parseSourceOffset("12")).toBe(12);
    expect(parseSourceOffset("12px")).toBe(12);
    expect(parseSourceOffset("")).toBeNull();
    expect(parseSourceOffset("abc")).toBeNull();
  });

  it("parses source ranges from raw values", () => {
    expect(sourceRangeFromValues("3", "8")).toEqual({ from: 3, to: 8 });
    expect(sourceRangeFromValues("3", undefined)).toBeNull();
    expect(sourceRangeFromValues("3", undefined, { defaultToFrom: true })).toEqual({ from: 3, to: 3 });
    expect(sourceRangeFromValues("8", "3", { requirePositive: true })).toBeNull();
  });

  it("parses source ranges from DOM datasets", () => {
    const element = document.createElement("span");
    element.dataset.shellFrom = "4";
    element.dataset.shellTo = "10";

    expect(sourceRangeFromDataset(element.dataset, "shellFrom", "shellTo")).toEqual({ from: 4, to: 10 });
  });

  it("finds source ranges on elements or their closest carriers", () => {
    const outer = document.createElement("p");
    outer.dataset.sourceFrom = "5";
    outer.dataset.sourceTo = "15";
    const inner = document.createElement("span");
    outer.append(inner);

    expect(sourceRangeFromElement(outer)).toEqual({ from: 5, to: 15 });
    expect(sourceRangeFromElement(inner)).toBeNull();
    expect(sourceRangeFromElement(inner, { closest: true })).toEqual({ from: 5, to: 15 });
  });
});
