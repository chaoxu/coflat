import { describe, expect, it } from "vitest";
import {
  createInlineMarkElement,
  inlineMarkClassName,
  inlineMarkTagName,
  renderInlineMarkHtml,
} from "./inline-mark-surface";

describe("inline mark surface", () => {
  it("maps inline mark kinds to the shared document tags and classes", () => {
    expect(inlineMarkTagName("emphasis")).toBe("em");
    expect(inlineMarkClassName("emphasis")).toBe("cf-italic");
    expect(inlineMarkTagName("strong")).toBe("strong");
    expect(inlineMarkClassName("strong")).toBe("cf-bold");
    expect(inlineMarkTagName("strikethrough")).toBe("del");
    expect(inlineMarkClassName("strikethrough")).toBe("cf-strikethrough");
    expect(inlineMarkTagName("code")).toBe("code");
    expect(inlineMarkClassName("code")).toBe("cf-doc-code-token cf-inline-code");
  });

  it("uses mark for document-body highlights and span for inline chrome surfaces", () => {
    expect(inlineMarkTagName("highlight", "document-body")).toBe("mark");
    expect(inlineMarkTagName("highlight", "document-inline")).toBe("span");
    expect(inlineMarkTagName("highlight", "table-preview-inline")).toBe("span");
    expect(inlineMarkTagName("highlight", "ui-chrome-inline")).toBe("span");
  });

  it("renders reader HTML with source attributes on the shared wrapper", () => {
    expect(
      renderInlineMarkHtml("strong", "Bold", {
        sourceAttrs: ' data-source-from="2" data-source-to="10"',
      }),
    ).toBe(
      '<strong class="cf-bold" data-source-from="2" data-source-to="10">Bold</strong>',
    );
  });

  it("creates editor DOM with the same classes and tag choices", () => {
    const code = createInlineMarkElement(document, "code");
    code.textContent = "x";
    expect(code.outerHTML).toBe(
      '<code class="cf-doc-code-token cf-inline-code">x</code>',
    );

    const highlight = createInlineMarkElement(document, "highlight", {
      surface: "ui-chrome-inline",
    });
    highlight.textContent = "marked";
    expect(highlight.outerHTML).toBe('<span class="cf-highlight">marked</span>');
  });
});
