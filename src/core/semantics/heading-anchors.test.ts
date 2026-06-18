import { describe, expect, it } from "vitest";

import {
  buildHeadingAnchorIds,
  reserveExplicitHeadingAnchorIds,
  slugifyHeadingAnchor,
  uniqueHeadingAnchorId,
} from "./heading-anchors";

describe("heading anchors", () => {
  it("slugifies heading text the same way for reader and editor outlines", () => {
    expect(slugifyHeadingAnchor("Méthodes & Results!")).toBe("methodes-results");
    expect(slugifyHeadingAnchor("!!!")).toBe("section");
  });

  it("reserves explicit ids before allocating generated anchors", () => {
    const anchors = buildHeadingAnchorIds([
      { from: 0, text: "Background" },
      { from: 20, text: "Setup", id: "background" },
      { from: 40, text: "Background" },
    ]);

    expect([...anchors.values()]).toEqual(["background-2", "background", "background-3"]);
  });

  it("deduplicates generated anchors with numeric suffixes", () => {
    const anchors = buildHeadingAnchorIds([
      { from: 0, text: "Notes" },
      { from: 10, text: "Notes" },
      { from: 20, text: "Notes" },
    ]);

    expect([...anchors.values()]).toEqual(["notes", "notes-2", "notes-3"]);
  });

  it("lets callers snapshot and roll back allocation state", () => {
    const used = reserveExplicitHeadingAnchorIds([{ id: "kept" }]);
    const before = new Set(used);
    expect(uniqueHeadingAnchorId({ text: "Kept" }, used)).toBe("kept-2");

    expect(uniqueHeadingAnchorId({ text: "Kept" }, before)).toBe("kept-2");
  });
});
