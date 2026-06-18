import { describe, expect, it } from "vitest";

import {
  headingBoundaryIndices,
  headingSectionEndOffsets,
} from "./section-boundaries";

describe("section boundary semantics", () => {
  it("finds the next heading of equal or higher level", () => {
    const headings = [
      { level: 1, from: 0 },
      { level: 2, from: 10 },
      { level: 3, from: 20 },
      { level: 2, from: 30 },
      { level: 1, from: 40 },
    ];

    expect(headingBoundaryIndices(headings)).toEqual([4, 3, 3, 4, null]);
    expect(headingSectionEndOffsets(headings, 50)).toEqual([40, 30, 30, 40, 50]);
  });

  it("keeps nested deeper headings inside their parent section", () => {
    const headings = [
      { level: 2, from: 5 },
      { level: 3, from: 10 },
      { level: 4, from: 15 },
    ];

    expect(headingBoundaryIndices(headings)).toEqual([null, null, null]);
    expect(headingSectionEndOffsets(headings, 25)).toEqual([25, 25, 25]);
  });
});
