import { describe, expect, it } from "vitest";

import { extractFileIndex } from "../index-helpers/extract";
import { analyzeMarkdownDocument } from "../semantics/markdown-analysis";
import {
  buildCitationRenderData,
  buildCitationRenderDataFromAnalysis,
  type CitationTextResourceResolver,
  loadBibliographyResource,
} from "./citation-render-data";

function createTextFileResolver(
  files: Record<string, string>,
  basePath: string,
): CitationTextResourceResolver {
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/") + 1) : "";
  return {
    async readProjectTextFile(path: string): Promise<string | null> {
      return files[`${baseDir}${path}`] ?? files[path] ?? null;
    },
  };
}

describe("loadBibliographyResource", () => {
  it("loads bibliography entries through the shared resource resolver", async () => {
    const resolver = createTextFileResolver({
      "notes/main.md": "# Main",
      "notes/refs/library.bib": [
        "@book{cite:knuth,",
        "  title = {Literate Programming},",
        "  author = {Knuth, Donald},",
        "  year = {1984}",
        "}",
      ].join("\n"),
    }, "notes/main.md");

    const bibliography = await loadBibliographyResource({
      bibliography: "refs/library.bib",
    }, resolver);

    expect(bibliography.store.get("cite:knuth")?.title).toBe("Literate Programming");
    expect(bibliography.status).toEqual({
      state: "ok",
      bibPath: "refs/library.bib",
      entryCount: 1,
    });
  });

  it("loads CSL JSON bibliographies detected by path and shape", async () => {
    const items = JSON.stringify([
      { id: "cite:knuth", type: "book", title: "Literate Programming" },
    ]);
    const resolver = createTextFileResolver({ "refs/library.json": items }, "main.md");

    const bibliography = await loadBibliographyResource({
      bibliography: "refs/library.json",
    }, resolver);

    expect(bibliography.store.get("cite:knuth")?.title).toBe("Literate Programming");
    expect(bibliography.status?.state).toBe("ok");
  });

  it("reports an idle status when no bibliography is configured", async () => {
    const bibliography = await loadBibliographyResource({}, createTextFileResolver({}, "main.md"));
    expect(bibliography.status).toEqual({ state: "idle" });
  });

  it("reports a read-bib error when the file cannot be read", async () => {
    const bibliography = await loadBibliographyResource({
      bibliography: "refs/missing.bib",
    }, createTextFileResolver({}, "main.md"));

    expect(bibliography.store.size).toBe(0);
    expect(bibliography.status).toMatchObject({
      state: "error",
      kind: "read-bib",
      bibPath: "refs/missing.bib",
    });
  });

  it("reports a parse-bib error for malformed CSL JSON", async () => {
    const resolver = createTextFileResolver({ "refs/broken.json": "[{ nope" }, "main.md");
    const bibliography = await loadBibliographyResource({
      bibliography: "refs/broken.json",
    }, resolver);

    expect(bibliography.store.size).toBe(0);
    expect(bibliography.status).toMatchObject({
      state: "error",
      kind: "parse-bib",
    });
  });

  it("reports a detect-format error for unrecognizable content", async () => {
    const resolver = createTextFileResolver(
      { "refs/library.txt": "certainly not a bibliography" },
      "main.md",
    );
    const bibliography = await loadBibliographyResource({
      bibliography: "refs/library.txt",
    }, resolver);

    expect(bibliography.status).toMatchObject({
      state: "error",
      kind: "detect-format",
    });
  });

  it("keeps valid entries and warns with a skip count for mixed CSL JSON", async () => {
    const mixed = JSON.stringify([
      { id: "good", type: "book", title: "Kept" },
      { id: "bad" },
      { type: "book" },
    ]);
    const resolver = createTextFileResolver({ "refs/mixed.json": mixed }, "main.md");
    const bibliography = await loadBibliographyResource({
      bibliography: "refs/mixed.json",
    }, resolver);

    expect([...bibliography.store.keys()]).toEqual(["good"]);
    expect(bibliography.status).toMatchObject({
      state: "warning",
      kind: "parse-bib",
      entryCount: 1,
      skippedEntries: 2,
    });
  });

  it("warns when the configured CSL style cannot be read", async () => {
    const resolver = createTextFileResolver({
      "refs/library.bib": "@book{k, title={T}, author={A. B.}, year={2000}}",
    }, "main.md");
    const bibliography = await loadBibliographyResource({
      bibliography: "refs/library.bib",
      csl: "styles/missing.csl",
    }, resolver);

    expect(bibliography.store.size).toBe(1);
    expect(bibliography.status).toMatchObject({
      state: "warning",
      kind: "read-csl",
      cslPath: "styles/missing.csl",
      entryCount: 1,
    });
  });
});

describe("buildCitationRenderData", () => {
  it("derives cited ids and backlinks from the loaded bibliography without React", () => {
    const citations = buildCitationRenderData(
      "See [@cite:knuth; @cite:lamport] and [@cite:knuth].",
      {
        store: new Map([
          ["cite:knuth", {
            id: "cite:knuth",
            title: "Literate Programming",
            type: "book",
          }],
          ["cite:lamport", {
            id: "cite:lamport",
            title: "LaTeX",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:knuth", "cite:lamport"]);
    expect(citations.backlinks.get("cite:knuth")).toHaveLength(2);
    expect(citations.backlinks.get("cite:lamport")).toHaveLength(1);
  });

  it("preserves repeated citation occurrences within one cluster", () => {
    const citations = buildCitationRenderData(
      "See [@cite:knuth; @cite:knuth].",
      {
        store: new Map([
          ["cite:knuth", {
            id: "cite:knuth",
            title: "Literate Programming",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:knuth"]);
    expect(citations.backlinks.get("cite:knuth")).toEqual([
      { occurrence: 1, from: 4, to: 30 },
      { occurrence: 1, from: 4, to: 30 },
    ]);
  });

  it("ignores citation syntax embedded in inline code and fenced code blocks", () => {
    const citations = buildCitationRenderData(
      [
        "Use `@cite:knuth` as a literal token.",
        "",
        "```md",
        "[@cite:lamport]",
        "```",
        "",
        "See [@cite:tufte].",
      ].join("\n"),
      {
        store: new Map([
          ["cite:knuth", {
            id: "cite:knuth",
            title: "Literate Programming",
            type: "book",
          }],
          ["cite:lamport", {
            id: "cite:lamport",
            title: "LaTeX",
            type: "book",
          }],
          ["cite:tufte", {
            id: "cite:tufte",
            title: "The Visual Display of Quantitative Information",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:tufte"]);
    expect(citations.backlinks.get("cite:knuth")).toBeUndefined();
    expect(citations.backlinks.get("cite:lamport")).toBeUndefined();
    expect(citations.backlinks.get("cite:tufte")).toHaveLength(1);
  });

  it("excludes local markdown targets that collide with bibliography keys", () => {
    const citations = buildCitationRenderData(
      [
        "# Intro",
        "",
        "## Background {#cite:heading}",
        "",
        "::: {.theorem #cite:block}",
        "Statement.",
        ":::",
        "",
        "$$x^2$$ {#eq:cite}",
        "",
        "See [@cite:heading], [@cite:block], [@eq:cite], and [@cite:real].",
      ].join("\n"),
      {
        store: new Map([
          ["cite:heading", {
            id: "cite:heading",
            title: "Heading collision",
            type: "book",
          }],
          ["cite:block", {
            id: "cite:block",
            title: "Block collision",
            type: "book",
          }],
          ["eq:cite", {
            id: "eq:cite",
            title: "Equation collision",
            type: "book",
          }],
          ["cite:real", {
            id: "cite:real",
            title: "Actual citation",
            type: "book",
          }],
        ]),
      },
    );

    expect(citations.citedIds).toEqual(["cite:real"]);
    expect(citations.backlinks.get("cite:heading")).toBeUndefined();
    expect(citations.backlinks.get("cite:block")).toBeUndefined();
    expect(citations.backlinks.get("eq:cite")).toBeUndefined();
    expect(citations.backlinks.get("cite:real")).toHaveLength(1);
  });

  it("classifies citation targets through the same semantic artifacts as the index", () => {
    const content = [
      "# Intro {#cite:heading}",
      "",
      "::: {.theorem #cite:block}",
      "Statement.",
      ":::",
      "",
      "$$x^2$$ {#eq:cite}",
      "",
      "See [@cite:heading], [@cite:block], [@eq:cite], and [@cite:real].",
    ].join("\n");
    const artifacts = analyzeMarkdownDocument(content, "paper.md");
    const index = extractFileIndex(content, "paper.md", artifacts);
    const citations = buildCitationRenderDataFromAnalysis(
      artifacts.analysis,
      {
        store: new Map([
          ["cite:heading", {
            id: "cite:heading",
            title: "Heading collision",
            type: "book",
          }],
          ["cite:block", {
            id: "cite:block",
            title: "Block collision",
            type: "book",
          }],
          ["eq:cite", {
            id: "eq:cite",
            title: "Equation collision",
            type: "book",
          }],
          ["cite:real", {
            id: "cite:real",
            title: "Actual citation",
            type: "book",
          }],
        ]),
      },
    );

    expect(index.entries.map((entry) => entry.label).filter(Boolean)).toEqual([
      "cite:block",
      "eq:cite",
      "cite:heading",
    ]);
    expect(citations.citedIds).toEqual(["cite:real"]);
    expect([...citations.store.keys()]).toEqual(["cite:real"]);
  });
});
