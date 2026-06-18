import { describe, expect, it } from "vitest";

import {
  renderDocumentFragmentToDom,
  renderDocumentFragmentToHtml,
} from "./document-surfaces";

describe("document surfaces", () => {
  it("uses chrome-safe degradation for chrome labels", () => {
    expect(
      renderDocumentFragmentToHtml({
        kind: "chrome-label",
        text: "[docs](https://example.com)",
      }),
    ).toBe("docs");
  });

  it("resolves references in chrome labels without making links active", () => {
    const html = renderDocumentFragmentToHtml({
      kind: "chrome-label",
      text: "[docs](https://example.com) for [@thm:main]",
      referenceContext: {
        classify(id) {
          if (id !== "thm:main") return { kind: "unresolved", id };
          return {
            kind: "crossref",
            resolved: {
              kind: "block",
              label: "Theorem 2",
              number: 2,
            },
          };
        },
        cite(ids) {
          return `[${ids.join(", ")}]`;
        },
        citeNarrative(id) {
          return id;
        },
      },
    });

    expect(html).toContain("docs for");
    expect(html).toContain("Theorem 2");
    expect(html).not.toContain("https://example.com");
  });

  it("keeps document-inline richness for titles", () => {
    expect(
      renderDocumentFragmentToHtml({
        kind: "title",
        text: "[docs](https://example.com)",
      }),
    ).toContain('href="https://example.com"');
  });

  it("renders footnote fragments through the DOM surface helper", () => {
    const container = document.createElement("div");
    renderDocumentFragmentToDom(container, {
      kind: "footnote",
      text: "Footnote with $x^2$",
    });
    expect(container.textContent).toContain("Footnote with");
    expect(container.querySelector(".katex")).not.toBeNull();
  });
});
