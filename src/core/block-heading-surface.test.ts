import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";
import {
  appendBlockDisclosure,
  createBlockSummaryFragment,
  createInlineBlockHeadingElement,
  renderBlockDisclosureHtml,
  renderBlockLabelHtml,
  renderBlockSummaryHtml,
  renderInlineBlockHeadingHtml,
} from "./block-heading-surface";

describe("block heading surface", () => {
  it("renders reader label and title HTML with the canonical classes", () => {
    expect(renderBlockLabelHtml("Theorem 4")).toBe(
      `<span class="${CSS.blockHeaderRendered}">Theorem 4</span>`,
    );
    expect(renderBlockSummaryHtml("Theorem 4", "<em>Main</em>")).toBe(
      `<span class="${CSS.blockHeaderRendered}">Theorem 4</span>` +
        `<span class="${CSS.blockAttrTitle}">` +
        `<span class="${CSS.blockTitleParen}">(</span>` +
        `<span><em>Main</em></span>` +
        `<span class="${CSS.blockTitleParen}">)</span>` +
        `</span>`,
    );
  });

  it("creates editor-preview summary DOM with the same label and title shell", () => {
    const summary = createBlockSummaryFragment(document, "Theorem 4", (title) => {
      title.append("Main");
    });
    const host = document.createElement("div");
    host.appendChild(summary);

    expect(host.innerHTML).toBe(
      `<span class="${CSS.blockHeaderRendered}">Theorem 4</span>` +
        `<span class="${CSS.blockAttrTitle}">` +
        `<span class="${CSS.blockTitleParen}">(</span>` +
        `<span>Main</span>` +
        `<span class="${CSS.blockTitleParen}">)</span>` +
        `</span>`,
    );
  });

  it("shares collapsible block heading and body wrappers", () => {
    expect(renderBlockDisclosureHtml("Summary", "<p>Body</p>")).toBe(
      `<div class="${DOCUMENT_SURFACE_CLASS.blockHeading}">` +
        `<span class="${CSS.blockHeadingContent}">Summary</span>` +
        `</div>` +
        `<div class="${CSS.blockDisclosureBody}"><p>Body</p></div>`,
    );

    const block = document.createElement("div");
    const summary = document.createDocumentFragment();
    summary.append("Summary");
    const body = document.createDocumentFragment();
    const paragraph = document.createElement("p");
    paragraph.append("Body");
    body.appendChild(paragraph);
    appendBlockDisclosure(block, summary, body);

    expect(block.innerHTML).toBe(
      `<div class="${DOCUMENT_SURFACE_CLASS.blockHeading}">` +
        `<span class="${CSS.blockHeadingContent}">Summary</span>` +
        `</div>` +
        `<div class="${CSS.blockDisclosureBody}"><p>Body</p></div>`,
    );
  });

  it("shares inline proof heading wrappers", () => {
    expect(renderInlineBlockHeadingHtml("Proof")).toBe(
      `<span class="${DOCUMENT_SURFACE_CLASS.blockHeading}">Proof</span>`,
    );

    const summary = document.createDocumentFragment();
    summary.append("Proof");
    expect(createInlineBlockHeadingElement(document, summary).outerHTML).toBe(
      `<span class="${DOCUMENT_SURFACE_CLASS.blockHeading}">Proof</span>`,
    );
  });
});
