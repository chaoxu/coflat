import { describe, expect, it } from "vitest";
import { buildLineOffsets, lineAt } from "./line-offsets";

describe("line-offsets", () => {
  it("maps offsets to 1-based line numbers", () => {
    const source = "a\nbb\nccc";
    const offsets = buildLineOffsets(source);
    expect(lineAt(offsets, 0)).toBe(1); // "a"
    expect(lineAt(offsets, 1)).toBe(1); // the "\n" still belongs to line 1
    expect(lineAt(offsets, 2)).toBe(2); // start of "bb"
    expect(lineAt(offsets, 5)).toBe(3); // start of "ccc"
    expect(lineAt(offsets, 7)).toBe(3); // last char
  });

  it("treats CRLF line endings as a single break", () => {
    const offsets = buildLineOffsets("a\r\nb");
    expect(lineAt(offsets, 0)).toBe(1);
    expect(lineAt(offsets, 3)).toBe(2); // "b" after \r\n
  });

  it("clamps out-of-range offsets to the last line", () => {
    const offsets = buildLineOffsets("a\nb");
    expect(lineAt(offsets, 999)).toBe(2);
  });

  it("handles an empty source as line 1", () => {
    expect(lineAt(buildLineOffsets(""), 0)).toBe(1);
  });
});
