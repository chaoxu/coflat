import { describe, expect, it } from "vitest";
import {
  coalescePendingRegions,
  mapPendingRegions,
  mergePendingRegions,
  pendingRegionsEqual,
  pendingTailRegions,
  subtractPendingRegions,
} from "./pending-regions";

describe("pending regions", () => {
  it("coalesces overlapping and touching regions and drops empties", () => {
    expect(coalescePendingRegions([
      { from: 5, to: 5 },
      { from: 8, to: 10 },
      { from: 1, to: 3 },
      { from: 3, to: 4 },
      { from: 9, to: 12 },
    ])).toEqual([
      { from: 1, to: 4 },
      { from: 8, to: 12 },
    ]);
  });

  it("keeps identity when mapping changes nothing", () => {
    const regions = [{ from: 1, to: 4 }];
    expect(mapPendingRegions(regions, (pos) => pos, 10)).toBe(regions);
  });

  it("over-approximates boundary insertions when mapping", () => {
    // Two characters inserted exactly at the region end must stay pending.
    const regions = [{ from: 2, to: 4 }];
    const mapped = mapPendingRegions(
      regions,
      (pos, assoc = -1) => (pos > 4 || (pos === 4 && assoc > 0) ? pos + 2 : pos),
      12,
    );
    expect(mapped).toEqual([{ from: 2, to: 6 }]);
  });

  it("drops regions deleted entirely and clamps to the document", () => {
    const regions = [
      { from: 2, to: 4 },
      { from: 6, to: 9 },
    ];
    // Deleting [2, 4) collapses the first region and shifts the second.
    const mapped = mapPendingRegions(
      regions,
      (pos) => (pos <= 2 ? pos : Math.max(2, pos - 2)),
      7,
    );
    expect(mapped).toEqual([{ from: 4, to: 7 }]);
  });

  it("merges additions preserving base identity on no-ops", () => {
    const base = [{ from: 0, to: 5 }];
    expect(mergePendingRegions(base, [])).toBe(base);
    expect(mergePendingRegions(base, [{ from: 2, to: 3 }])).toBe(base);
    expect(mergePendingRegions(base, [{ from: 7, to: 9 }])).toEqual([
      { from: 0, to: 5 },
      { from: 7, to: 9 },
    ]);
  });

  it("subtracts ranges preserving identity on no-ops", () => {
    const regions = [
      { from: 0, to: 10 },
      { from: 20, to: 30 },
    ];
    expect(subtractPendingRegions(regions, [{ from: 12, to: 15 }])).toBe(regions);
    expect(subtractPendingRegions(regions, [{ from: 3, to: 5 }])).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 10 },
      { from: 20, to: 30 },
    ]);
    expect(subtractPendingRegions(regions, [{ from: 0, to: 25 }])).toEqual([
      { from: 25, to: 30 },
    ]);
    expect(subtractPendingRegions(regions, [{ from: 0, to: 30 }])).toEqual([]);
  });

  it("compares region lists by value", () => {
    expect(pendingRegionsEqual([{ from: 1, to: 2 }], [{ from: 1, to: 2 }])).toBe(true);
    expect(pendingRegionsEqual([{ from: 1, to: 2 }], [{ from: 1, to: 3 }])).toBe(false);
    expect(pendingRegionsEqual([], [])).toBe(true);
  });

  it("builds the unparsed tail region", () => {
    expect(pendingTailRegions(5, 10)).toEqual([{ from: 5, to: 10 }]);
    expect(pendingTailRegions(10, 10)).toEqual([]);
  });
});
