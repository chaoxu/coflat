import { describe, expect, it } from "vitest";
import {
  createNumericCitationFormatter,
  parseBibliographyKeys,
} from "../../../numeric";

describe("lightweight numeric citation helpers", () => {
  it("parses BibTeX keys without citation-js", () => {
    const source = [
      "@article{knuth1984, title={T}}",
      "@string{jan = {January}}",
      "@book(lamport1994, title={L})",
      "@comment{ignored}",
      "@misc{knuth1984, title={duplicate}}",
    ].join("\n");

    expect(parseBibliographyKeys(source)).toEqual(["knuth1984", "lamport1994"]);
  });

  it("formats stable numeric citations and bibliography entries", () => {
    const formatter = createNumericCitationFormatter(["knuth1984"]);

    expect(formatter.cite(["knuth1984", "unknown"], [undefined, "p. 4"]))
      .toBe("[1; 2, p. 4]");
    expect(formatter.citeNarrative("unknown")).toBe("[2]");

    formatter.registerCitations([{ ids: ["knuth1984", "unknown"] }]);
    expect(formatter.revision).toBe(1);
    expect(formatter.citationRegistrationKey).toBe("knuth1984,unknown");
    expect(formatter.bibliographyEntries(["knuth1984", "unknown"]))
      .toEqual([
        {
          id: "knuth1984",
          html: '<span class="csl-left-margin">[1]</span> <span class="csl-right-inline">knuth1984</span>',
        },
        {
          id: "unknown",
          html: '<span class="csl-left-margin">[2]</span> <span class="csl-right-inline">unknown</span>',
        },
      ]);
  });

  it("uses available BibTeX metadata in lightweight bibliography entries", () => {
    const formatter = createNumericCitationFormatter([{
      id: "cormen2009",
      title: "Introduction to Algorithms",
      publisher: "MIT Press",
      author: [{ family: "Cormen", given: "Thomas H." }],
      issued: { "date-parts": [[2009]] },
    }]);

    formatter.registerCitations([{ ids: ["cormen2009"] }]);

    expect(formatter.bibliographyEntries(["cormen2009"])[0]?.html)
      .toContain("Cormen, Thomas H. Introduction to Algorithms. MIT Press. 2009.");
  });
});
