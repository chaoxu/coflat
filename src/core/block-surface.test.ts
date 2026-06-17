import { describe, expect, it } from "vitest";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";
import {
  blockSurfaceClassNames,
  createBlankLineElement,
  createBlockquoteElement,
  createHorizontalRuleElement,
  renderBlankLineHtml,
  renderBlockquoteHtml,
  renderHorizontalRuleHtml,
} from "./block-surface";

describe("block surface", () => {
  it("shares generic block wrapper classes", () => {
    expect(blockSurfaceClassNames(undefined)).toBe(DOCUMENT_SURFACE_CLASS.block);
    expect(blockSurfaceClassNames("hr")).toBe("cf-doc-block cf-doc-block--hr");
    expect(blockSurfaceClassNames("theorem")).toBe("cf-doc-block cf-doc-block--theorem");
  });

  it("shares horizontal rule HTML and DOM", () => {
    expect(renderHorizontalRuleHtml(' data-source-from="1"')).toBe(
      '<hr class="cf-doc-block cf-doc-block--hr" data-source-from="1">',
    );
    expect(createHorizontalRuleElement(document).outerHTML).toBe(
      '<hr class="cf-doc-block cf-doc-block--hr">',
    );
  });

  it("shares blank line HTML and DOM", () => {
    expect(renderBlankLineHtml(' data-source-from="1" data-source-to="2"')).toBe(
      '<div class="cf-doc-blank-line" aria-hidden="true" data-source-from="1" data-source-to="2"><br></div>',
    );
    expect(createBlankLineElement(document).outerHTML).toBe(
      '<div class="cf-doc-blank-line" aria-hidden="true"><br></div>',
    );
  });

  it("shares blockquote HTML and DOM", () => {
    expect(renderBlockquoteHtml("<p>Body</p>", ' data-source-from="1"')).toBe(
      '<blockquote class="cf-doc-blockquote" data-source-from="1"><p>Body</p></blockquote>',
    );
    const blockquote = createBlockquoteElement(document);
    blockquote.append("Body");
    expect(blockquote.outerHTML).toBe('<blockquote class="cf-doc-blockquote">Body</blockquote>');
  });
});
