import { describe, expect, it } from "vitest";

import {
  initialHeadingNumberCounters,
  nextHeadingNumber,
} from "./heading-numbering";

describe("heading numbering", () => {
  it("assigns hierarchical section numbers", () => {
    let counters = initialHeadingNumberCounters();
    const numbers: string[] = [];
    for (const heading of [
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: false },
      { level: 2, unnumbered: false },
      { level: 3, unnumbered: false },
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: false },
    ]) {
      const result = nextHeadingNumber(heading, counters);
      counters = result.counters;
      numbers.push(result.number);
    }

    expect(numbers).toEqual(["1", "1.1", "1.2", "1.2.1", "2", "2.1"]);
  });

  it("does not advance counters for unnumbered headings", () => {
    let counters = initialHeadingNumberCounters();
    const numbers: string[] = [];
    for (const heading of [
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: false },
      { level: 2, unnumbered: true },
      { level: 2, unnumbered: false },
      { level: 1, unnumbered: false },
    ]) {
      const result = nextHeadingNumber(heading, counters);
      counters = result.counters;
      numbers.push(result.number);
    }

    expect(numbers).toEqual(["1", "1.1", "", "1.2", "2"]);
  });

  it("returns a fresh counter array so callers can snapshot reader state", () => {
    const counters = initialHeadingNumberCounters();
    const result = nextHeadingNumber({ level: 1, unnumbered: false }, counters);

    expect(result.counters).not.toBe(counters);
    expect(counters).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(result.counters).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
});
