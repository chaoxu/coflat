import { describe, expect, it } from "vitest";
import {
  analyzeReferences,
  buildReferenceCatalog,
} from "../../parse";

const fixture = [
  "# Intro {#sec:intro}",
  "",
  "::: {.definition #def:main title=\"Term\"}",
  "A term.",
  ":::",
  "",
  "::: {.theorem #thm:main title=\"Main\"}",
  "A theorem.",
  ":::",
  "",
  "$$",
  "x = 1",
  "$$ {#eq:one}",
  "",
  "See [@sec:intro; @def:main; @thm:main; @eq:one; @external, p. 7].",
].join("\n");

describe("buildReferenceCatalog", () => {
  it("returns shared target labels for headings, blocks, equations, and refs", () => {
    const catalog = buildReferenceCatalog(fixture);

    expect(catalog.targets.map((target) => [
      target.kind,
      target.id,
      target.displayLabel,
    ])).toEqual([
      ["heading", "sec:intro", "Section 1"],
      ["block", "def:main", "Definition 1"],
      ["block", "thm:main", "Theorem 1"],
      ["equation", "eq:one", "Eq. (1)"],
    ]);

    expect(catalog.uniqueTargetById.get("thm:main")?.displayLabel)
      .toBe("Theorem 1");
    expect(catalog.references).toMatchObject([
      {
        raw: "[@sec:intro; @def:main; @thm:main; @eq:one; @external, p. 7]",
        ids: ["sec:intro", "def:main", "thm:main", "eq:one", "external"],
        locators: [undefined, undefined, undefined, undefined, "p. 7"],
      },
    ]);
  });

  it("analyzeReferences is the public alias for the same catalog", () => {
    expect(analyzeReferences(fixture).targets.map((target) => target.displayLabel))
      .toEqual(buildReferenceCatalog(fixture).targets.map((target) => target.displayLabel));
  });
});
