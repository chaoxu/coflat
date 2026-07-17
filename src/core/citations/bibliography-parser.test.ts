import { describe, expect, it } from "vitest";
import {
  detectBibliographyFormat,
  parseBibliography,
} from "./bibliography-parser";

const cslJson = JSON.stringify([
  {
    id: "karger2000",
    type: "article-journal",
    title: "Minimum cuts in near-linear time",
    author: [{ family: "Karger", given: "David R." }],
    issued: { "date-parts": [[2000]] },
  },
  {
    id: "stein2001",
    type: "book",
    title: "Algorithms",
  },
]);

const bibtex = `@article{karger2000,
  author = {Karger, David R.},
  title = {Minimum cuts in near-linear time},
  year = {2000}
}`;

describe("detectBibliographyFormat", () => {
  it("prefers the path extension when recognized", () => {
    expect(detectBibliographyFormat("[]", "refs.bib")).toBe("bibtex");
    expect(detectBibliographyFormat("@article{x,", "refs.json")).toBe("csl-json");
    expect(detectBibliographyFormat("", "refs.yaml")).toBe("csl-yaml");
    expect(detectBibliographyFormat("", "refs.YML")).toBe("csl-yaml");
  });

  it("falls back to content shape without a usable extension", () => {
    expect(detectBibliographyFormat(cslJson)).toBe("csl-json");
    expect(detectBibliographyFormat(bibtex)).toBe("bibtex");
    expect(detectBibliographyFormat("references:\n- id: a\n  type: book\n")).toBe("csl-yaml");
    expect(detectBibliographyFormat("\uFEFF  [1]")).toBe("csl-json");
    expect(detectBibliographyFormat("plain prose")).toBeNull();
  });
});

describe("parseBibliography: CSL JSON", () => {
  it("parses a valid CSL JSON array", () => {
    const result = parseBibliography(cslJson, { path: "refs.json" });
    expect(result.format).toBe("csl-json");
    expect(result.error).toBeUndefined();
    expect(result.skippedEntries).toBe(0);
    expect(result.items.map((item) => item.id)).toEqual(["karger2000", "stein2001"]);
    expect(result.items[0].title).toBe("Minimum cuts in near-linear time");
  });

  it("reports malformed JSON as a parse error", () => {
    const result = parseBibliography("[{ not json", { path: "refs.json" });
    expect(result.format).toBe("csl-json");
    expect(result.items).toEqual([]);
    expect(result.error).toContain("Invalid CSL JSON");
  });

  it("rejects a non-array JSON root", () => {
    const result = parseBibliography("{\"id\": \"a\", \"type\": \"book\"}", { path: "refs.json" });
    expect(result.items).toEqual([]);
    expect(result.error).toBe("CSL data must be an array of items");
  });

  it("skips invalid entries and counts them", () => {
    const mixed = JSON.stringify([
      { id: "good", type: "book" },
      { id: "", type: "book" },
      { id: "missing-type" },
      { id: 42, type: "book" },
      "not an object",
      null,
    ]);
    const result = parseBibliography(mixed, { path: "refs.json" });
    expect(result.items.map((item) => item.id)).toEqual(["good", "42"]);
    expect(result.skippedEntries).toBe(4);
    expect(result.error).toBeUndefined();
  });
});

describe("parseBibliography: CSL YAML", () => {
  it("parses a Pandoc-style references mapping", () => {
    const yaml = [
      "references:",
      "- id: karger2000",
      "  type: article-journal",
      "  title: Minimum cuts in near-linear time",
      "- id: stein2001",
      "  type: book",
    ].join("\n");
    const result = parseBibliography(yaml, { path: "refs.yaml" });
    expect(result.format).toBe("csl-yaml");
    expect(result.items.map((item) => item.id)).toEqual(["karger2000", "stein2001"]);
    expect(result.skippedEntries).toBe(0);
  });

  it("parses a bare YAML list and skips invalid entries", () => {
    const yaml = [
      "- id: good",
      "  type: book",
      "- id: bad-no-type",
    ].join("\n");
    const result = parseBibliography(yaml, { path: "refs.yml" });
    expect(result.items.map((item) => item.id)).toEqual(["good"]);
    expect(result.skippedEntries).toBe(1);
  });

  it("reports invalid YAML as a parse error", () => {
    const result = parseBibliography("references: [unclosed", { path: "refs.yaml" });
    expect(result.items).toEqual([]);
    expect(result.error).toContain("Invalid CSL YAML");
  });
});

describe("parseBibliography: BibTeX and detection fallback", () => {
  it("delegates .bib content to the BibTeX parser", () => {
    const result = parseBibliography(bibtex, { path: "refs.bib" });
    expect(result.format).toBe("bibtex");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("karger2000");
  });

  it("honors an explicit format option over detection", () => {
    const result = parseBibliography(cslJson, { format: "csl-json", path: "refs.bib" });
    expect(result.format).toBe("csl-json");
    expect(result.items).toHaveLength(2);
  });

  it("reports a detection failure for unrecognizable content", () => {
    const result = parseBibliography("just some prose, not a bibliography");
    expect(result.format).toBeNull();
    expect(result.items).toEqual([]);
    expect(result.error).toContain("Could not detect bibliography format");
  });

  it("returns an empty ok result for blank content", () => {
    const result = parseBibliography("   \n");
    expect(result.items).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});
