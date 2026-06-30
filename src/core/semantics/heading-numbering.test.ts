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
    expect(result.counters.values).not.toBe(counters.values);
    expect(counters).toEqual({ appendix: false, values: [0, 0, 0, 0, 0, 0, 0] });
    expect(result.counters).toEqual({ appendix: false, values: [0, 1, 0, 0, 0, 0, 0] });
  });

  it("switches following headings into appendix numbering", () => {
    let counters = initialHeadingNumberCounters();
    const numbers: string[] = [];
    for (const heading of [
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: false },
      { level: 1, unnumbered: true, appendixBoundary: true },
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: false },
      { level: 1, unnumbered: false },
      { level: 2, unnumbered: true },
      { level: 2, unnumbered: false },
    ]) {
      const result = nextHeadingNumber(heading, counters);
      counters = result.counters;
      numbers.push(result.number);
    }

    expect(numbers).toEqual(["1", "1.1", "", "A", "A.1", "B", "", "B.1"]);
  });

  it("uses an implicit appendix letter for subheadings before the first appendix h1", () => {
    let counters = initialHeadingNumberCounters();
    const numbers: string[] = [];
    for (const heading of [
      { level: 1, unnumbered: false },
      { level: 1, unnumbered: true, appendixBoundary: true },
      { level: 2, unnumbered: false },
      { level: 3, unnumbered: false },
      { level: 1, unnumbered: false },
    ]) {
      const result = nextHeadingNumber(heading, counters);
      counters = result.counters;
      numbers.push(result.number);
    }

    expect(numbers).toEqual(["1", "", "A.1", "A.1.1", "B"]);
  });

  it("continues appendix letters past Z", () => {
    let counters = nextHeadingNumber(
      { level: 1, unnumbered: true, appendixBoundary: true },
      initialHeadingNumberCounters(),
    ).counters;

    let last = "";
    for (let index = 0; index < 27; index += 1) {
      const result = nextHeadingNumber({ level: 1, unnumbered: false }, counters);
      counters = result.counters;
      last = result.number;
    }

    expect(last).toBe("AA");
  });
});
