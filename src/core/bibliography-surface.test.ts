import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import {
  appendBibliographyBacklinks,
  BIBLIOGRAPHY_BACKLINK_TEXT,
  bibliographyEntryId,
  bibliographyListElement,
  createBibliographyBacklinksElement,
  createBibliographyEntryElement,
  createBibliographySectionElement,
  renderBibliographySectionHtml,
} from "./bibliography-surface";

describe("bibliography surface", () => {
  it("renders reader bibliography HTML with the canonical section structure", () => {
    expect(renderBibliographySectionHtml([
      { id: "smith:2024", html: "<span>[1] Smith</span>" },
    ])).toBe(
      '<div class="cf-bibliography" aria-label="Bibliography"><h2 class="cf-bibliography-heading">Bibliography</h2><div class="cf-bibliography-list"><div class="cf-bibliography-entry" id="bib-smith%3A2024"><span>[1] Smith</span></div></div></div>',
    );
  });

  it("creates editor bibliography DOM with the same classes and encoded ids", () => {
    const section = createBibliographySectionElement(document);
    const list = bibliographyListElement(section);
    const entry = createBibliographyEntryElement(document, "smith:2024");
    entry.textContent = "[1] Smith";
    list.appendChild(entry);

    expect(section.className).toBe(CSS.bibliography);
    expect(section.getAttribute("aria-label")).toBe("Bibliography");
    expect(section.querySelector(`.${CSS.bibliographyHeading}`)?.textContent).toBe("Bibliography");
    expect(section.querySelector(`.${CSS.bibliographyList}`)).toBe(list);
    expect(entry.className).toBe(CSS.bibliographyEntry);
    expect(entry.id).toBe(bibliographyEntryId("smith:2024"));
  });

  it("creates canonical bibliography backlink groups", () => {
    const backlinks = createBibliographyBacklinksElement(document, [
      { occurrence: 1, sourceFrom: 12 },
      { occurrence: 2, sourceFrom: 34, ariaLabel: "Jump to second citation" },
    ]);

    expect(backlinks?.outerHTML).toBe(
      '<span class="cf-bibliography-backlinks">' +
        `<a class="cf-bibliography-backlink" href="#cite-ref-1" data-source-from="12" aria-label="Jump to citation">${BIBLIOGRAPHY_BACKLINK_TEXT}</a> ` +
        `<a class="cf-bibliography-backlink" href="#cite-ref-2" data-source-from="34" aria-label="Jump to second citation">${BIBLIOGRAPHY_BACKLINK_TEXT}</a>` +
        "</span>",
    );
  });

  it("appends bibliography backlinks after entry content", () => {
    const entry = createBibliographyEntryElement(document, "smith:2024");
    entry.textContent = "[1] Smith";

    appendBibliographyBacklinks(entry, [{ occurrence: 1, sourceFrom: 12 }]);

    expect(entry.outerHTML).toBe(
      '<div class="cf-bibliography-entry" id="bib-smith%3A2024">[1] Smith ' +
        `<span class="cf-bibliography-backlinks"><a class="cf-bibliography-backlink" href="#cite-ref-1" data-source-from="12" aria-label="Jump to citation">${BIBLIOGRAPHY_BACKLINK_TEXT}</a></span>` +
        "</div>",
    );
  });
});
