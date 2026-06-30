import { describe, expect, it } from "vitest";
import {
  createFootnoteSectionElement,
  footnoteBackrefHref,
  footnoteEntryId,
  footnoteSectionPlan,
  footnoteSectionPlanFromNumberedEntries,
  footnoteSectionPlanFromOrderedEntries,
  renderFootnoteSectionHtml,
} from "./footnote-section-surface";

describe("footnote section surface", () => {
  it("shares encoded footnote entry ids", () => {
    expect(footnoteEntryId("note:1")).toBe("fn-note%3A1");
    expect(footnoteBackrefHref("note:1")).toBe("#fnref-note%3A1");
  });

  it("plans section entries and filters entries without content", () => {
    expect(footnoteSectionPlan([
      { num: 1, id: "a", defFrom: 12 },
      { num: 2, id: "missing", include: false },
      { num: 3, id: "orphan", defFrom: 40 },
    ])).toEqual([
      { num: 1, id: "a", defFrom: 12, backrefHref: "#fnref-a" },
      { num: 3, id: "orphan", defFrom: 40, backrefHref: "#fnref-orphan" },
    ]);
  });

  it("plans section entries from ordered footnote semantics", () => {
    expect(footnoteSectionPlanFromOrderedEntries([
      { number: 1, id: "a", defFrom: 12 },
      { number: 2, id: "missing", include: false },
      { number: 3, id: "orphan", defFrom: 40 },
    ], { backrefs: false })).toEqual([
      { num: 1, id: "a", defFrom: 12, backrefHref: undefined },
      { num: 3, id: "orphan", defFrom: 40, backrefHref: undefined },
    ]);
  });

  it("preserves source entries while projecting shared section fields", () => {
    const def = { from: 12, content: "Body" };

    expect(footnoteSectionPlanFromNumberedEntries([
      { number: 1, id: "a", defFrom: 12, def },
      { number: 2, id: "missing", include: false, def: { from: 20, content: "" } },
    ])).toEqual([
      {
        number: 1,
        num: 1,
        id: "a",
        defFrom: 12,
        def,
        backrefHref: "#fnref-a",
      },
    ]);
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

  it("can omit global navigation ids for embedded editor copies", () => {
    const section = createFootnoteSectionElement(document, [
      {
        num: 1,
        id: "note:1",
        defFrom: 20,
        backrefHref: "#fnref-note%3A1",
        includeId: false,
        includeBackrefHref: false,
        appendContent: (content) => {
          content.textContent = "Body";
        },
      },
    ]);

    expect(section.outerHTML).toBe(
      '<div class="cf-footnote-section" aria-label="Footnotes">' +
        '<h2 class="cf-bibliography-heading">Footnotes</h2>' +
        '<div class="cf-bibliography-list">' +
        '<div class="cf-bibliography-entry" data-def-from="20">' +
        '<sup class="cf-bibliography-entry-number">1</sup>' +
        '<span>Body</span> <a class="cf-footnote-backref">↩</a>' +
        '</div></div></div>',
    );
  });
});
