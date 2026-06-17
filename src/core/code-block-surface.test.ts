import { describe, expect, it } from "vitest";
import { CSS } from "./constants/css-classes";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";
import {
  appendCodeBlockDom,
  codeBlockLanguageClass,
  codeBlockLanguageToken,
  createCodeBlockLanguageElement,
  renderCodeBlockHtml,
} from "./code-block-surface";

describe("code block surface", () => {
  it("normalizes language tokens for syntax class names", () => {
    expect(codeBlockLanguageToken("ts meta")).toBe("ts");
    expect(codeBlockLanguageClass("ts meta")).toBe("language-ts");
    expect(codeBlockLanguageClass("c++")).toBe("");
  });

  it("renders reader code block HTML with canonical language chrome", () => {
    expect(renderCodeBlockHtml("ts", "const x = 1;", ' data-source-from="4"')).toBe(
      `<pre class="${DOCUMENT_SURFACE_CLASS.codeBlock}" data-lang="ts" data-source-from="4">` +
        `<span class="${CSS.codeblockLanguage}">ts</span>` +
        '<code class="language-ts">const x = 1;</code></pre>',
    );
  });

  it("creates the shared code block language label DOM", () => {
    const label = createCodeBlockLanguageElement(document, "ts");

    expect(label.outerHTML).toBe(`<span class="${CSS.codeblockLanguage}">ts</span>`);
  });

  it("creates preview/editor code block DOM with the same language label", () => {
    const host = document.createDocumentFragment();

    appendCodeBlockDom(host, document, "ts", "const x = 1;");

    const pre = host.firstElementChild;
    expect(pre?.outerHTML).toBe(
      `<pre class="${DOCUMENT_SURFACE_CLASS.codeBlock}" data-lang="ts">` +
        `<span class="${CSS.codeblockLanguage}">ts</span>` +
        '<code class="language-ts">const x = 1;</code></pre>',
    );
  });
});
