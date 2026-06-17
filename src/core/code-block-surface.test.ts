import { afterEach, describe, expect, it, vi } from "vitest";
import { CSS } from "./constants/css-classes";
import { COPY_RESET_MS } from "./constants/timing";
import { DOCUMENT_SURFACE_CLASS } from "./document-surface-classes";
import {
  appendCodeBlockDom,
  codeBlockLanguageClass,
  codeBlockLanguageToken,
  createCodeBlockCopyButtonController,
  createCodeBlockLanguageElement,
  renderCodeBlockHtml,
} from "./code-block-surface";

const copyIcon = [["path", { d: "M1 1h1" }]] as const;
const checkIcon = [["path", { d: "M2 2h1" }]] as const;

afterEach(() => {
  vi.useRealTimers();
});

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

  it("creates the shared code block copy button DOM and copied state", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);
    const controller = createCodeBlockCopyButtonController(document, "const x = 1;", {
      copy: copyIcon,
      check: checkIcon,
    }, {
      clipboard: { writeText },
    });
    document.body.appendChild(controller.element);

    expect(controller.element.className).toBe(CSS.codeblockCopy);
    expect(controller.element.type).toBe("button");
    expect(controller.element.getAttribute("aria-label")).toBe("Copy code to clipboard");
    expect(controller.element.querySelector(".lucide-copy")).not.toBeNull();

    controller.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("const x = 1;");
    expect(controller.element.getAttribute("aria-label")).toBe("Copied");
    expect(controller.element.querySelector(".lucide-check")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(COPY_RESET_MS);

    expect(controller.element.getAttribute("aria-label")).toBe("Copy code to clipboard");
    expect(controller.element.querySelector(".lucide-copy")).not.toBeNull();

    controller.destroy();
    controller.element.remove();
  });
});
