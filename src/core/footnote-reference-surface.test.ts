import { describe, expect, it } from "vitest";
import {
  createEditorFootnoteReferenceElement,
  createReaderFootnoteReferenceElement,
  footnoteAnchorId,
  footnoteReferenceAnchorId,
  renderReaderFootnoteReferenceHtml,
} from "./footnote-reference-surface";

describe("footnote reference surface", () => {
  it("shares encoded footnote ids", () => {
    expect(footnoteAnchorId("note:1")).toBe("fn-note%3A1");
    expect(footnoteReferenceAnchorId("note:1")).toBe("fnref-note%3A1");
  });

  it("renders reader footnote reference HTML", () => {
    expect(renderReaderFootnoteReferenceHtml(3, "note:1", ' data-source-from="2"')).toBe(
      '<sup class="cf-footnote-ref" data-source-from="2">' +
        '<a href="#fn-note%3A1" id="fnref-note%3A1">3</a>' +
        "</sup>",
    );
  });

  it("creates reader footnote reference DOM", () => {
    const el = createReaderFootnoteReferenceElement(document, "3", "note:1");
    expect(el.outerHTML).toBe(
      '<sup class="cf-footnote-ref"><a href="#fn-note%3A1" id="fnref-note%3A1">3</a></sup>',
    );
  });

  it("creates editor footnote reference DOM", () => {
    const el = createEditorFootnoteReferenceElement(document, 3, "note:1");
    expect(el.outerHTML).toBe(
      '<sup class="cf-footnote-ref cf-sidenote-ref" data-footnote-id="note:1" aria-label="Footnote note:1">' +
        '<a href="#fn-note%3A1">3</a>' +
        "</sup>",
    );
  });
});
