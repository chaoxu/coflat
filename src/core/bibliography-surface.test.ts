import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  bibliographyEntryId,
  bibliographyListElement,
  createBibliographyEntryElement,
  createBibliographySectionElement,
  renderBibliographySectionHtml,
} from "./bibliography-surface";

describe("bibliography surface", () => {
  it("renders reader bibliography HTML with the canonical section structure", () => {
    expect(renderBibliographySectionHtml([
      { id: "smith:2024", html: "<span>[1] Smith</span>" },
    ])).toBe(
      '<div class="cf-bibliography" aria-label="References"><h2 class="cf-bibliography-heading">References</h2><div class="cf-bibliography-list"><div class="cf-bibliography-entry" id="bib-smith%3A2024"><span>[1] Smith</span></div></div></div>',
    );
  });

  it("creates editor bibliography DOM with the same classes and encoded ids", () => {
    const section = createBibliographySectionElement(document);
    const list = bibliographyListElement(section);
    const entry = createBibliographyEntryElement(document, "smith:2024");
    entry.textContent = "[1] Smith";
    list.appendChild(entry);

    expect(section.className).toBe(CSS.bibliography);
    expect(section.getAttribute("aria-label")).toBe("References");
    expect(section.querySelector(`.${CSS.bibliographyHeading}`)?.textContent).toBe("References");
    expect(section.querySelector(`.${CSS.bibliographyList}`)).toBe(list);
    expect(entry.className).toBe(CSS.bibliographyEntry);
    expect(entry.id).toBe(bibliographyEntryId("smith:2024"));
  });
});
