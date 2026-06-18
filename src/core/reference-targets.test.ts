import { describe, expect, it } from "vitest";

import {
  blockReferenceTarget,
  buildReferenceTargetIndexes,
  compareDocumentReferenceTargetPreference,
  equationReferenceTarget,
  getPreferredDocumentReferenceTarget,
  headingReferenceTarget,
  sortDocumentReferenceTargets,
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
});
