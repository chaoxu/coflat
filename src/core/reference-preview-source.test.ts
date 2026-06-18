import { describe, expect, it } from "vitest";
import {
  blockReferenceTarget,
  equationReferenceTarget,
  headingReferenceTarget,
} from "./reference-targets";
import {
  blockPreviewBodyInputFromSource,
  blockReferencePreviewEntry,
  fencedDivBodySource,
  fencedDivBodyRangeFromSource,
  equationReferencePreviewEntry,
  findEquationPreviewSource,
  findFencedDivPreviewSource,
  findHeadingPreviewSource,
  findReferencePreviewSource,
  headingReferencePreviewEntry,
  referencePreviewBodyInputFromEntry,
  referencePreviewBodyPlan,
  referencePreviewContentPlanFromEntry,
  referencePreviewContentPlanFromSource,
  referencePreviewEntryFromTarget,
  referencePreviewHeaderText,
  stripBracedLabelId,
  trimReferencePreviewRange,
  unresolvedReferencePreviewLabel,
} from "./reference-preview-source";

describe("reference preview source helpers", () => {
  it("formats shared hover preview labels", () => {
    expect(referencePreviewHeaderText({
      kind: "heading",
      label: "Section 2",
      title: "Main result",
    }, "sec:main")).toBe("Section 2 Main result");
    expect(referencePreviewHeaderText({
      kind: "block",
      label: "Theorem 4",
      title: "Theorem 4",
    }, "thm:main")).toBe("Theorem 4");
    expect(unresolvedReferencePreviewLabel("missing")).toBe("Unresolved: missing");
  });

  it("plans shared hover preview bodies", () => {
    expect(referencePreviewBodyPlan({ kind: "heading" })).toEqual({
      kind: "none",
      key: "none",
    });

    expect(referencePreviewBodyPlan({ kind: "equation", latex: " a=b " }))
      .toEqual({
        kind: "display-math",
        latex: "a=b",
        markdownSource: "$$\na=b\n$$",
        key: "display-math\0a=b",
      });

    expect(referencePreviewBodyPlan({
      kind: "block",
      fullSource: "::: {.theorem #t}\nBody\n:::",
      bodySource: "\nBody\n",
      useFullSource: false,
    })).toEqual({
      kind: "markdown",
      markdownSource: "Body",
      key: "body\0Body",
    });

    expect(referencePreviewBodyPlan({
      kind: "block",
      fullSource: "::: {.figure #f}\n![x](x.png)\n:::",
      bodySource: "![x](x.png)",
      useFullSource: true,
    })).toMatchObject({
      kind: "markdown",
      markdownSource: "::: {.figure #f}\n![x](x.png)\n:::",
      key: "full\0::: {.figure #f}\n![x](x.png)\n:::",
    });
  });

  it("plans shared hover preview content from indexed entries", () => {
    const source = "::: {.theorem #thm:main title=\"Main\"}\nBody\n:::";
    const entry = blockReferencePreviewEntry({
      id: "thm:main",
      label: "Theorem 1",
      blockType: "theorem",
      title: "Main",
      sourceRange: { from: 0, to: source.length },
      bodyRange: { from: source.indexOf("Body"), to: source.indexOf("\n:::") },
      number: 1,
    });

    expect(referencePreviewContentPlanFromEntry(entry, source, "thm:main")).toMatchObject({
      headerText: "Theorem 1 Main",
      bodyPlan: {
        kind: "markdown",
        markdownSource: "Body",
      },
      suppressGeneratedSectionNumbers: false,
    });

    const heading = headingReferencePreviewEntry({
      id: "sec:intro",
      label: "Section 2",
      title: "Intro",
      level: 1,
      sourceRange: { from: 0, to: 20 },
    });
    expect(referencePreviewContentPlanFromEntry(heading, source, "sec:intro")).toMatchObject({
      headerText: "Section 2 Intro",
      bodyPlan: { kind: "none" },
    });
  });

  it("builds shared reference preview entries", () => {
    expect(headingReferencePreviewEntry({
      id: "sec:intro",
      label: "Section 2",
      title: "Intro",
      level: 2,
      sourceRange: { from: 10, to: 20 },
      number: "2",
    })).toEqual({
      kind: "heading",
      id: "sec:intro",
      label: "Section 2",
      title: "Intro",
      text: "Intro",
      level: 2,
      from: 10,
      to: 20,
      number: "2",
    });

    expect(equationReferencePreviewEntry({
      id: "eq:main",
      label: "Eq. (3)",
      latex: "x^2",
      sourceRange: { from: 30, to: 50 },
      bodyRange: { from: 33, to: 36 },
      number: 3,
    })).toEqual({
      kind: "equation",
      id: "eq:main",
      label: "Eq. (3)",
      latex: "x^2",
      text: "x^2",
      from: 30,
      to: 50,
      bodyFrom: 33,
      bodyTo: 36,
      number: "3",
      ordinal: 3,
    });

    expect(blockReferencePreviewEntry({
      id: "thm:main",
      label: "Theorem 4",
      blockType: "theorem",
      title: "Main",
      sourceRange: { from: 50, to: 80 },
      bodyRange: { from: 60, to: 70 },
      number: 4,
    })).toEqual({
      kind: "block",
      id: "thm:main",
      label: "Theorem 4",
      blockType: "theorem",
      title: "Main",
      from: 50,
      to: 80,
      bodyFrom: 60,
      bodyTo: 70,
      number: "4",
      ordinal: 4,
    });
  });

  it("builds shared reference preview entries from document targets", () => {
    expect(referencePreviewEntryFromTarget(headingReferenceTarget({
      from: 0,
      to: 20,
      id: "sec:intro",
      number: "2",
      text: "Intro",
    }), {
      fallbackId: "sec:intro",
      headingLevel: 1,
    })).toEqual({
      kind: "heading",
      id: "sec:intro",
      label: "Section 2",
      title: "Intro",
      text: "Intro",
      level: 1,
      from: 0,
      to: 20,
      number: "2",
    });

    expect(referencePreviewEntryFromTarget(equationReferenceTarget({
      from: 30,
      to: 50,
      id: "eq:main",
      number: 3,
      latex: "x^2",
    }), {
      fallbackId: "eq:main",
      bodyRange: { from: 33, to: 36 },
    })).toEqual({
      kind: "equation",
      id: "eq:main",
      label: "Eq. (3)",
      latex: "x^2",
      text: "x^2",
      from: 30,
      to: 50,
      bodyFrom: 33,
      bodyTo: 36,
      number: "3",
      ordinal: 3,
    });

    expect(referencePreviewEntryFromTarget(blockReferenceTarget({
      from: 50,
      to: 80,
      id: "thm:main",
      blockType: "theorem",
      displayTitle: "Theorem",
      title: "Main",
      number: 4,
    }), {
      fallbackId: "thm:main",
      bodyRange: { from: 60, to: 70 },
    })).toEqual({
      kind: "block",
      id: "thm:main",
      label: "Theorem 4",
      blockType: "theorem",
      title: "Main",
      from: 50,
      to: 80,
      bodyFrom: 60,
      bodyTo: 70,
      number: "4",
      ordinal: 4,
    });
  });

  it("extracts shared block preview body ranges from source offsets", () => {
    const source = [
      "# Intro",
      "",
      "::: {.theorem #thm:main}",
      "",
      "  Body  ",
      "",
      ":::",
    ].join("\n");
    const blockFrom = source.indexOf(":::");
    const openFenceTo = source.indexOf("\n", blockFrom);
    const closeFenceFrom = source.lastIndexOf(":::");
    const range = fencedDivBodyRangeFromSource(source, {
      blockRange: { from: blockFrom, to: source.length },
      openFenceTo,
      closeFenceFrom,
    });

    expect(source.slice(range.from, range.to)).toBe("Body");
    expect(blockPreviewBodyInputFromSource(source, {
      fullRange: { from: blockFrom, to: source.length },
      bodyRange: range,
      useFullSource: false,
    })).toEqual({
      kind: "block",
      fullSource: source.slice(blockFrom),
      bodySource: "Body",
      useFullSource: false,
    });
    expect(trimReferencePreviewRange(source, {
      from: source.indexOf("\n  Body"),
      to: source.indexOf("\n:::", blockFrom),
    })).toEqual(range);
  });

  it("builds shared body inputs from indexed preview entries", () => {
    const source = "::: {.theorem #thm:main}\nBody\n:::";
    const blockEntry = blockReferencePreviewEntry({
      id: "thm:main",
      label: "Theorem 1",
      blockType: "theorem",
      sourceRange: { from: 0, to: source.length },
      bodyRange: { from: source.indexOf("Body"), to: source.indexOf("\n:::") },
      title: "Main",
      number: 1,
    });

    expect(referencePreviewBodyInputFromEntry(headingReferencePreviewEntry({
      id: "intro",
      label: "Section 1",
      title: "Intro",
      level: 1,
      sourceRange: { from: 0, to: 7 },
    }))).toEqual({ kind: "heading" });
    expect(referencePreviewBodyInputFromEntry(equationReferencePreviewEntry({
      id: "eq:one",
      label: "Equation 1",
      latex: "x = y",
      sourceRange: { from: 0, to: 14 },
      bodyRange: { from: 2, to: 7 },
      number: 1,
    }))).toEqual({ kind: "equation", latex: "x = y" });
    expect(referencePreviewBodyInputFromEntry(blockEntry, source)).toEqual({
      kind: "block",
      fullSource: source,
      bodySource: "Body",
      useFullSource: false,
    });
    expect(referencePreviewBodyInputFromEntry(blockEntry, source, { useFullSource: true })).toEqual({
      kind: "block",
      fullSource: source,
      bodySource: "Body",
      useFullSource: true,
    });
  });

  it("extracts dollar and bracket display math preview source", () => {
    expect(findEquationPreviewSource("$$\na=b\n$$ {#eq:one}", "eq:one"))
      .toBe("$$\na=b\n$$");
    expect(findEquationPreviewSource("\\[\na=b\n\\] {#eq:two}", "eq:two"))
      .toBe("\\[\na=b\n\\]");
    expect(stripBracedLabelId("$$\na=b\n$$ {#eq:one}", "eq:one"))
      .toBe("$$\na=b\n$$");
  });

  it("extracts heading and fenced-div preview source", () => {
    const source = [
      "# Intro",
      "## Result {#sec:result}",
      "",
      '::: {.theorem #thm:main title="Main"}',
      "Statement.",
      ":::",
    ].join("\n");

    expect(findHeadingPreviewSource(source, "sec:result")).toBe("## Result {#sec:result}");
    const fencedDiv = findFencedDivPreviewSource(source, "thm:main");
    expect(fencedDiv).toContain("Statement.");
    expect(fencedDivBodySource(fencedDiv ?? "")).toBe("Statement.");
  });

  it("returns the first supported source preview match in reader fallback order", () => {
    expect(findReferencePreviewSource("$$\na=b\n$$ {#eq:one}", "eq:one"))
      .toMatchObject({ kind: "equation", previewSource: "$$\na=b\n$$" });
    expect(findReferencePreviewSource("## Result {#sec:result}", "sec:result"))
      .toMatchObject({ kind: "heading", previewSource: "## Result" });
    expect(findReferencePreviewSource(
      "::: {.theorem #thm:main title=\"Main\"}\nStatement.\n:::",
      "thm:main",
    )).toMatchObject({
      kind: "fenced-div",
      previewSource: "Statement.",
    });
  });

  it("plans reader fallback source previews without surface-local interpretation", () => {
    expect(referencePreviewContentPlanFromSource(
      "$$\na=b\n$$ {#eq:one}",
      "eq:one",
      "Eq. (1)",
    )).toMatchObject({
      headerText: "Eq. (1)",
      bodyPlan: {
        kind: "markdown",
        markdownSource: "$$\na=b\n$$",
      },
      suppressGeneratedSectionNumbers: false,
    });

    expect(referencePreviewContentPlanFromSource(
      "## Result {#sec:result}",
      "sec:result",
      "Section 2",
    )).toMatchObject({
      headerText: "Section 2",
      bodyPlan: {
        kind: "markdown",
        markdownSource: "## Result",
      },
      suppressGeneratedSectionNumbers: true,
    });
  });
});
