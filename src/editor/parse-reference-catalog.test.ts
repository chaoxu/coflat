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

  it("annotates targets and references with 1-based line numbers", () => {
    const catalog = buildReferenceCatalog(fixture);
    expect(catalog.uniqueTargetById.get("sec:intro")?.line).toBe(1);
    expect(catalog.uniqueTargetById.get("def:main")?.line).toBe(3);
    expect(catalog.uniqueTargetById.get("thm:main")?.line).toBe(7);
    const eq = catalog.uniqueTargetById.get("eq:one");
    expect(eq?.line).toBeGreaterThanOrEqual(11);
    expect(eq?.line).toBeLessThanOrEqual(13);
    // The single citation cluster sits on the last line of the fixture.
    expect(catalog.references[0]?.line).toBe(15);
  });

  it("counts lines over the full source, including frontmatter", () => {
    const withFrontmatter = [
      "---",
      "title: Doc",
      "---",
      "",
      "# Heading {#sec:h}",
    ].join("\n");
    // Heading is on source line 5, not line 1 of the frontmatter-stripped body.
    expect(buildReferenceCatalog(withFrontmatter).uniqueTargetById.get("sec:h")?.line)
      .toBe(5);
  });

  it("uses frontmatter global numbering for block target labels", () => {
    const source = [
      "---",
      "numbering: global",
      "---",
      "",
      "::: {.theorem #thm:first}",
      "First.",
      ":::",
      "",
      "::: {.table #tbl:apps}",
      "table",
      ":::",
      "",
      "::: {.proposition #prop:middle}",
      "Middle.",
      ":::",
      "",
      "::: {.theorem #thm:target}",
      "Target.",
      ":::",
    ].join("\n");

    expect(buildReferenceCatalog(source).targets.map((target) => [
      target.kind,
      target.id,
      target.displayLabel,
    ])).toEqual([
      ["block", "thm:first", "Theorem 1"],
      ["block", "tbl:apps", "Table 2"],
      ["block", "prop:middle", "Proposition 3"],
      ["block", "thm:target", "Theorem 4"],
    ]);
  });
});
