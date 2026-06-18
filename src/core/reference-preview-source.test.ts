import { describe, expect, it } from "vitest";
import {
  fencedDivBodySource,
  findEquationPreviewSource,
  findFencedDivPreviewSource,
  findHeadingPreviewSource,
  findReferencePreviewSource,
  referencePreviewHeaderText,
  stripBracedLabelId,
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
  });
});
