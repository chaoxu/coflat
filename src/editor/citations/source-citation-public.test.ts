import { describe, expect, it } from "vitest";
import {
  collectCitationClustersFromSource,
  prepareCitationFormatterFromSource,
} from "../../../citeproc";

const bibText = `
@book{alpha, title={Alpha}, author={A. Author}, year={2020}}
@book{beta, title={Beta}, author={B. Author}, year={2021}}
@book{thm:local, title={Local collision}, author={C. Author}, year={2022}}
`;

describe("public source citation helpers", () => {
  it("collects clustered and narrative citations while filtering local targets", () => {
    const source = [
      "::: {.theorem #thm:local}",
      "Statement.",
      ":::",
      "",
      "See [@thm:local; @alpha, p. 3] and @beta.",
    ].join("\n");
    const keys = new Set(["alpha", "beta", "thm:local"]);

    expect(collectCitationClustersFromSource(source, keys)).toEqual([
      { ids: ["alpha"], locators: ["p. 3"] },
      { ids: ["beta"], locators: [undefined] },
    ]);
  });

  it("prepares and registers a formatter from source and BibTeX", async () => {
    const prepared = await prepareCitationFormatterFromSource({
      source: "See [@beta] and [@alpha].",
      bibText,
    });

    expect(prepared?.citedKeys).toEqual(["beta", "alpha"]);
    expect(prepared?.clusters).toEqual([
      { ids: ["beta"], locators: [undefined] },
      { ids: ["alpha"], locators: [undefined] },
    ]);
    expect(prepared?.keys.has("alpha")).toBe(true);
    expect(prepared?.formatter.cite(["beta"], [undefined])).toBe("[1]");
  });

  it("accepts CSL JSON bibliographies by content shape", async () => {
    const cslJsonBib = JSON.stringify([
      { id: "alpha", type: "book", title: "Alpha", author: [{ family: "Author", given: "A." }] },
    ]);
    const prepared = await prepareCitationFormatterFromSource({
      source: "See [@alpha].",
      bibText: cslJsonBib,
    });

    expect(prepared?.citedKeys).toEqual(["alpha"]);
    expect(prepared?.formatter.cite(["alpha"], [undefined])).toBe("[1]");
  });

  it("registers frontmatter nocite keys after the in-text citations", async () => {
    const source = [
      "---",
      "nocite: \"@alpha\"",
      "---",
      "",
      "See [@beta].",
    ].join("\n");
    const prepared = await prepareCitationFormatterFromSource({ source, bibText });

    expect(prepared?.citedKeys).toEqual(["beta", "alpha"]);
    // Clusters stay in-text only; nocite affects registration and citedKeys.
    expect(prepared?.clusters).toEqual([{ ids: ["beta"], locators: [undefined] }]);
    expect(prepared?.formatter.cite(["beta"], [undefined])).toBe("[1]");
    expect(prepared?.formatter.cite(["alpha"], [undefined])).toBe("[2]");
    const entryIds = prepared?.formatter.bibliographyEntries(["beta", "alpha"]).map((entry) => entry.id);
    expect(entryIds).toContain("alpha");
    expect(entryIds).toContain("beta");
  });

  it("prepares a formatter for a nocite-only document (@* wildcard)", async () => {
    const prepared = await prepareCitationFormatterFromSource({
      source: "---\nnocite: \"@*\"\n---\n\nNo citations.",
      bibText,
    });

    expect(prepared).not.toBeNull();
    expect(prepared?.citedKeys).toEqual(["alpha", "beta", "thm:local"]);
    expect(prepared?.clusters).toEqual([]);
  });
});
