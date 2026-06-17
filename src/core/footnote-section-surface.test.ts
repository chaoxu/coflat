import { describe, expect, it } from "vitest";
import {
  createFootnoteSectionElement,
  footnoteEntryId,
  renderFootnoteSectionHtml,
} from "./footnote-section-surface";

describe("footnote section surface", () => {
  it("shares encoded footnote entry ids", () => {
    expect(footnoteEntryId("note:1")).toBe("fn-note%3A1");
  });

  it("renders reader footnote section HTML with canonical chrome", () => {
    expect(
      renderFootnoteSectionHtml([
        {
          num: 1,
          id: "note:1",
          html: "<em>Body</em>",
          defFrom: 20,
          backrefHref: "#fnref-note%3A1",
        },
      ]),
    ).toBe(
      '<div class="cf-footnote-section" aria-label="Footnotes">' +
        '<h2 class="cf-bibliography-heading">Footnotes</h2>' +
        '<div class="cf-bibliography-list">' +
        '<div id="fn-note%3A1" class="cf-bibliography-entry" data-def-from="20">' +
        '<sup class="cf-bibliography-entry-number">1</sup>' +
        '<span><em>Body</em></span> <a href="#fnref-note%3A1" class="cf-footnote-backref">↩</a>' +
        '</div></div></div>',
    );
  });

  it("creates editor footnote section DOM with the same chrome", () => {
    const section = createFootnoteSectionElement(document, [
      {
        num: 1,
        id: "note:1",
        defFrom: 20,
        backrefHref: "#fnref-note%3A1",
        appendContent: (content) => {
          const em = content.ownerDocument.createElement("em");
          em.textContent = "Body";
          content.appendChild(em);
        },
      },
    ]);

    expect(section.outerHTML).toBe(
      '<div class="cf-footnote-section" aria-label="Footnotes">' +
        '<h2 class="cf-bibliography-heading">Footnotes</h2>' +
        '<div class="cf-bibliography-list">' +
        '<div id="fn-note%3A1" class="cf-bibliography-entry" data-def-from="20">' +
        '<sup class="cf-bibliography-entry-number">1</sup>' +
        '<span><em>Body</em></span> <a href="#fnref-note%3A1" class="cf-footnote-backref">↩</a>' +
        '</div></div></div>',
    );
  });
});
