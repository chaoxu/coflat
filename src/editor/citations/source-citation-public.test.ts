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
});
