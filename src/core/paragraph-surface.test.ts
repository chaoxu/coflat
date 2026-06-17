import { describe, expect, it } from "vitest";
import {
  appendParagraphDom,
  createParagraphDom,
  renderParagraphHtml,
} from "./paragraph-surface";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";

describe("paragraph surface", () => {
  it("renders the canonical reader paragraph wrapper", () => {
    expect(renderParagraphHtml("Body", ' data-source-from="1" data-source-to="5"'))
      .toBe('<p class="cf-doc-paragraph" data-source-from="1" data-source-to="5">Body</p>');
  });

  it("creates the canonical editor-preview paragraph wrapper", () => {
    const host = document.createElement("div");
    appendParagraphDom(host, document, (paragraph) => {
      paragraph.append("Body");
    });

    expect(host.innerHTML).toBe(`<p class="${DOCUMENT_SURFACE_CLASS.paragraph}">Body</p>`);
  });

  it("can create a paragraph before the caller decides insertion order", () => {
    const paragraph = createParagraphDom(document, (node) => {
      node.append("Body");
    });

    expect(paragraph.outerHTML).toBe(`<p class="${DOCUMENT_SURFACE_CLASS.paragraph}">Body</p>`);
  });
});
