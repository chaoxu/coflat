import { describe, expect, it } from "vitest";
import {
  applySourceRangeAttrs,
  closestMathSourceCarrier,
  closestSourceRangeCarrier,
  mapDomRangeToSource,
  parseSourceOffset,
  sourceRangeAttrs,
  sourceRangeFromDataset,
  sourceRangeFromElement,
  sourceRangeFromValues,
  visibleSourcePositionInScroller,
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

  it("finds source carriers while honoring ignored surface classes", () => {
    const line = document.createElement("div");
    line.className = "cm-line";
    line.dataset.sourceFrom = "0";
    line.dataset.sourceTo = "10";
    const widget = document.createElement("span");
    widget.dataset.sourceFrom = "3";
    widget.dataset.sourceTo = "8";
    const child = document.createElement("span");
    widget.append(child);
    line.append(widget);

    expect(closestSourceRangeCarrier(child)).toBe(widget);
    expect(closestSourceRangeCarrier(line, { ignoredClassNames: ["cm-line"] })).toBeNull();
  });

  it("finds math source carriers by semantic data attribute", () => {
    const math = document.createElement("span");
    math.className = "cf-math-inline";
    math.dataset.math = "x^2";
    const child = document.createElement("span");
    math.append(child);

    expect(closestMathSourceCarrier(child)).toBe(math);
  });

  it("returns the visible carrier's viewport ratio when sampling the scroller", () => {
    const scroller = document.createElement("div");
    const block = document.createElement("p");
    block.dataset.sourceFrom = "20";
    block.dataset.sourceTo = "40";
    scroller.append(block);
    scroller.getBoundingClientRect = () => ({
      top: 100,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    block.getBoundingClientRect = () => ({
      top: 180,
      bottom: 260,
      left: 0,
      right: 300,
      width: 300,
      height: 80,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    });

    expect(visibleSourcePositionInScroller(scroller, { viewportRatio: 0.3 })).toEqual({
      pos: 20,
      viewportRatio: 0.2,
      viewportY: 180,
    });
  });

  it("prefers visible non-empty source ranges over zero-length carriers", () => {
    const scroller = document.createElement("div");
    const block = document.createElement("p");
    block.dataset.sourceFrom = "20";
    block.dataset.sourceTo = "40";
    const cursor = document.createElement("span");
    cursor.dataset.sourceFrom = "25";
    cursor.dataset.sourceTo = "25";
    scroller.append(block, cursor);
    scroller.getBoundingClientRect = () => ({
      top: 100,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    block.getBoundingClientRect = () => ({
      top: 190,
      bottom: 260,
      left: 0,
      right: 300,
      width: 300,
      height: 70,
      x: 0,
      y: 190,
      toJSON: () => ({}),
    });
    cursor.getBoundingClientRect = () => ({
      top: 180,
      bottom: 204,
      left: 0,
      right: 300,
      width: 300,
      height: 24,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    });

    expect(visibleSourcePositionInScroller(scroller, { viewportRatio: 0.2 })).toMatchObject({
      pos: 20,
    });
  });

  it("does not use zero-length carriers as scroll anchors", () => {
    const scroller = document.createElement("div");
    const cursor = document.createElement("div");
    cursor.dataset.sourceFrom = "25";
    cursor.dataset.sourceTo = "25";
    scroller.append(cursor);
    scroller.getBoundingClientRect = () => ({
      top: 100,
      bottom: 500,
      left: 0,
      right: 300,
      width: 300,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    cursor.getBoundingClientRect = () => ({
      top: 180,
      bottom: 204,
      left: 0,
      right: 300,
      width: 300,
      height: 24,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    });

    expect(visibleSourcePositionInScroller(scroller, { viewportRatio: 0.2 })).toBeNull();
  });

  it("maps DOM ranges to source offsets from shared source carriers", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p data-source-from="10" data-source-to="15">hello</p>';
    const text = container.querySelector("p")?.firstChild;
    if (!(text instanceof Text)) throw new Error("expected text node");
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);

    expect(mapDomRangeToSource(range, container)).toEqual({ from: 11, to: 14 });
  });

  it("collapses DOM ranges inside math carriers to the full source range", () => {
    const container = document.createElement("div");
    container.innerHTML = '<span data-math="x^2" data-source-from="4" data-source-to="9"><span>x</span><sup>2</sup></span>';
    const text = container.querySelector("sup")?.firstChild;
    if (!(text instanceof Text)) throw new Error("expected text node");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);

    expect(mapDomRangeToSource(range, container)).toEqual({ from: 4, to: 9 });
  });
});
