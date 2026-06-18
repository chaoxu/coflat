import { describe, expect, it } from "vitest";

import {
  blockReferenceTarget,
  buildDocumentReferenceTargetCollection,
  buildReferenceTargetIndexes,
  compareDocumentReferenceTargetPreference,
  equationReferenceTarget,
  getPreferredDocumentReferenceTarget,
  headingReferenceTarget,
  mapDocumentReferenceTargets,
  resolvedCrossrefFromReferenceTarget,
  setPreferredDocumentReferenceTarget,
  sortDocumentReferenceTargets,
  type DocumentReferenceTarget,
} from "./reference-targets";

describe("reference target helpers", () => {
  it("builds shared labels for heading, equation, and block targets", () => {
    expect(headingReferenceTarget({
      from: 20,
      to: 30,
      id: "sec:intro",
      number: "2.1",
      text: "Intro",
      line: 3,
    })).toMatchObject({
      kind: "heading",
      displayLabel: "Section 2.1",
      number: "2.1",
      title: "Intro",
      text: "Intro",
      line: 3,
    });

    expect(equationReferenceTarget({
      from: 40,
      to: 50,
      id: "eq:main",
      number: 7,
      latex: "x^2",
    })).toMatchObject({
      kind: "equation",
      displayLabel: "Eq. (7)",
      number: "7",
      ordinal: 7,
      text: "x^2",
    });

    expect(blockReferenceTarget({
      from: 60,
      to: 70,
      id: "thm:main",
      blockType: "theorem",
      displayTitle: "Theorem",
      title: "Main",
      number: 4,
    })).toMatchObject({
      kind: "block",
      displayLabel: "Theorem 4",
      number: "4",
      ordinal: 4,
      title: "Main",
      blockType: "theorem",
    });
  });

  it("sorts and indexes duplicate targets with block preference", () => {
    const heading = headingReferenceTarget({
      from: 20,
      to: 30,
      id: "dup",
      number: "1",
      text: "Duplicate",
    });
    const block = blockReferenceTarget({
      from: 10,
      to: 15,
      id: "dup",
      blockType: "theorem",
      displayTitle: "Theorem",
      number: 1,
    });

    const targets = sortDocumentReferenceTargets([heading, block]);
    expect(targets.map((target) => target.kind)).toEqual(["block", "heading"]);

    const indexes = buildReferenceTargetIndexes(targets);
    expect(indexes.uniqueTargetById.has("dup")).toBe(false);
    expect(indexes.duplicatesById.get("dup")).toHaveLength(2);
    expect(getPreferredDocumentReferenceTarget(indexes.targetsById, "dup")?.kind)
      .toBe("block");
  });

  it("compares target preference without reordering equal kinds", () => {
    expect(compareDocumentReferenceTargetPreference({ kind: "block" }, { kind: "heading" }))
      .toBeLessThan(0);
    expect(compareDocumentReferenceTargetPreference({ kind: "equation" }, { kind: "block" }))
      .toBeGreaterThan(0);
    expect(compareDocumentReferenceTargetPreference({ kind: "heading" }, { kind: "heading" }))
      .toBe(0);
  });

  it("collects sorted targets and indexes duplicate ids from one core helper", () => {
    const heading = headingReferenceTarget({
      from: 30,
      to: 40,
      id: "dup",
      number: "1",
      text: "Duplicate",
    });
    const equation = equationReferenceTarget({
      from: 10,
      to: 20,
      id: "eq:main",
      number: 1,
      latex: "x",
    });
    const block = blockReferenceTarget({
      from: 20,
      to: 25,
      id: "dup",
      blockType: "theorem",
      displayTitle: "Theorem",
      number: 1,
    });

    const collection = buildDocumentReferenceTargetCollection([heading, equation, block]);

    expect(collection.targets.map((target) => target.kind)).toEqual([
      "equation",
      "block",
      "heading",
    ]);
    expect(collection.uniqueTargetById.get("eq:main")?.kind).toBe("equation");
    expect(collection.uniqueTargetById.has("dup")).toBe(false);
    expect(collection.duplicatesById.get("dup")).toHaveLength(2);
  });

  it("updates preferred target maps with the shared target preference policy", () => {
    const targets = new Map<string, DocumentReferenceTarget>();
    const heading = headingReferenceTarget({
      from: 20,
      to: 30,
      id: "dup",
      number: "1",
      text: "Duplicate",
    });
    const block = blockReferenceTarget({
      from: 10,
      to: 15,
      id: "dup",
      blockType: "theorem",
      displayTitle: "Theorem",
      number: 1,
    });

    expect(setPreferredDocumentReferenceTarget(targets, "dup", heading)).toBe(true);
    expect(setPreferredDocumentReferenceTarget(targets, "dup", block)).toBe(true);
    expect(setPreferredDocumentReferenceTarget(targets, "dup", heading)).toBe(false);
    expect(targets.get("dup")).toBe(block);
  });

  it("maps target positions while preserving target identity for no-op changes", () => {
    const heading = headingReferenceTarget({
      from: 20,
      to: 30,
      id: "sec:intro",
      number: "1",
      text: "Intro",
    });
    const unchanged = mapDocumentReferenceTargets([heading], {
      mapPos(pos) {
        return pos;
      },
    });
    expect(unchanged[0]).toBe(heading);
    expect(unchanged).toBeInstanceOf(Array);

    const mapped = mapDocumentReferenceTargets([heading], {
      mapPos(pos) {
        return pos + 5;
      },
    });
    expect(mapped[0]).toMatchObject({
      from: 25,
      to: 35,
      id: "sec:intro",
    });
    expect(mapped[0]).not.toBe(heading);
  });

  it("maps document targets into shared resolved crossref shapes", () => {
    expect(resolvedCrossrefFromReferenceTarget(blockReferenceTarget({
      from: 10,
      to: 20,
      id: "thm:main",
      blockType: "theorem",
      displayTitle: "Theorem",
      title: "Main theorem",
      number: 4,
    }))).toEqual({
      kind: "block",
      label: "Theorem 4",
      title: "Main theorem",
      number: 4,
    });

    expect(resolvedCrossrefFromReferenceTarget(equationReferenceTarget({
      from: 30,
      to: 40,
      id: "eq:main",
      number: 2,
      latex: "x^2",
    }))).toEqual({
      kind: "equation",
      label: "Eq. (2)",
      number: 2,
    });

    expect(resolvedCrossrefFromReferenceTarget(headingReferenceTarget({
      from: 50,
      to: 60,
      id: "sec:intro",
      number: "1.2",
      text: "Intro",
    }))).toEqual({
      kind: "heading",
      label: "Section 1.2",
      title: "Intro",
    });
  });
});
