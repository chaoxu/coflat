import { describe, expect, it } from "vitest";
import {
  createFootnoteNumberingState,
  ensureFootnoteNumber,
  footnoteNumberingState,
} from "./footnote-ordering";

describe("footnote ordering", () => {
  it("numbers first references before orphan definitions", () => {
    const state = footnoteNumberingState(
      [{ id: "b" }, { id: "a" }, { id: "b" }],
      [{ id: "orphan" }, { id: "a" }],
    );

    expect([...state.numberById]).toEqual([
      ["b", 1],
      ["a", 2],
      ["orphan", 3],
    ]);
    expect(state.orderedIds).toEqual(["b", "a", "orphan"]);
  });

  it("supports incremental reader-style allocation with stable duplicate numbers", () => {
    const state = createFootnoteNumberingState();

    expect(ensureFootnoteNumber(state, "note")).toBe(1);
    expect(ensureFootnoteNumber(state, "later")).toBe(2);
    expect(ensureFootnoteNumber(state, "note")).toBe(1);
    expect([...state.numberById]).toEqual([
      ["note", 1],
      ["later", 2],
    ]);
    expect(state.orderedIds).toEqual(["note", "later"]);
  });
});
