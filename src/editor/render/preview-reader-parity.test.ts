/**
 * Golden conformance test between the reader's HTML-string emission
 * (renderToHtml) and the editor preview's DOM emission
 * (renderPreviewBlockContentToDom) — issue #31.
 *
 * Both pipelines parse with the same Lezer grammar and must agree on the
 * block-level structure, cf-doc-* classes, and data attributes they emit.
 * Documented divergences are normalized away instead of compared:
 *  - reader-only disclosure <button>s.
 */
import { describe, expect, it } from "vitest";
import { renderToHtml } from "../../reader/reader";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "input",
  "table", "thead", "tbody", "tr", "th", "td", "hr", "div",
]);

const INLINE_CLASS_TAGS = new Set(["em", "strong", "del", "mark"]);
const COMPARED_SPAN_CLASSES = new Set([
  "cf-block-attr-title",
  "cf-block-heading-content",
  "cf-block-header-rendered",
  "cf-block-title-paren",
  "cf-list-bullet",
  "cf-list-number",
]);

function shouldSkip(el: Element): boolean {
  return el.tagName === "BUTTON";
}

/** Flatten an element tree into comparable structural lines. */
function summarize(root: Element, depth = 0): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.children)) {
    if (shouldSkip(el)) continue;
    const tag = el.tagName.toLowerCase();
    const parts = [`${"  ".repeat(depth)}<${tag}`];
    const parentTag = el.parentElement?.tagName.toLowerCase();
    const compareInlineClasses = INLINE_CLASS_TAGS.has(tag) && parentTag !== "pre";
    const compareCodeBlockClass = tag === "code" && parentTag === "pre";
    const compareSpanClasses = tag === "span" && [...el.classList].some((cls) => COMPARED_SPAN_CLASSES.has(cls));
    if (BLOCK_TAGS.has(tag) || compareInlineClasses) {
      const classes = [...el.classList]
        .filter((cls) => cls !== "cf-doc-block-collapsible")
        .sort()
        .join(" ");
      if (classes) parts.push(`class="${classes}"`);
    } else if (compareCodeBlockClass) {
      const classes = [...el.classList].sort().join(" ");
      if (classes) parts.push(`class="${classes}"`);
    } else if (compareSpanClasses) {
      const classes = [...el.classList].sort().join(" ");
      if (classes) parts.push(`class="${classes}"`);
    }
    if (BLOCK_TAGS.has(tag)) {
      for (const attr of [
        "data-align", "data-checked", "data-heading-numbering", "data-lang",
        "data-section-number", "data-status", "data-title", "id", "start",
      ]) {
        const value = el.getAttribute(attr);
        if (value) parts.push(`${attr}="${value}"`);
      }
    }
    if (tag === "input") {
      // `checked` is compared as a property: the reader parses the content
      // attribute, the preview sets the property — both land here.
      parts.push(`type="${el.getAttribute("type")}"`);
      parts.push(`checked=${(el as HTMLInputElement).checked}`);
      parts.push(`disabled=${(el as HTMLInputElement).disabled}`);
      const ariaDisabled = el.getAttribute("aria-disabled");
      if (ariaDisabled) parts.push(`aria-disabled="${ariaDisabled}"`);
    }
    out.push(`${parts.join(" ")}>`);
    out.push(...summarize(el, depth + 1));
  }
  return out;
}

function readerSummary(source: string): string[] {
  const host = document.createElement("div");
  host.innerHTML = renderToHtml(source).html;
  return summarize(host);
}

function previewSummary(source: string): string[] {
  const host = document.createElement("div");
  renderPreviewBlockContentToDom(host, source);
  return summarize(host);
}

describe("reader / editor-preview emission parity", () => {
  it.each([
    {
      name: "headings with levels, unnumbered marker, and label",
      source: "# One\n\n## Two {-}\n\n### Three {#sec:three}",
    },
    {
      name: "setext headings",
      source: "Setext One\n==========\n\nSetext Two\n----------\n\nbody",
    },
    {
      // Two paragraphs: the reader deliberately unwraps a lone top-level
      // paragraph to bare inline ("short input" shape), so single-paragraph
      // documents are not comparable at the block level.
      name: "paragraphs with inline marks",
      source: "Hello *world* and **bold** and `code` and ~~gone~~ and ==marked==.\n\nSecond paragraph.",
    },
    {
      name: "paragraph soft line breaks",
      source: "First source line with **bold** text\nsecond source line with `code` and ==mark==.\n\nNext paragraph.",
    },
    {
      name: "paragraph hard line break",
      source: "First source line  \nsecond source line.\n\nNext paragraph.",
    },
    {
      name: "tight unordered list",
      source: "- one\n- two\n- three",
    },
    {
      name: "loose ordered list",
      source: "1. one\n\n2. two",
    },
    {
      name: "task list",
      source: "- [ ] open\n- [x] done",
    },
    {
      name: "ordered list with explicit start",
      source: "3. three\n4. four",
    },
    {
      name: "nested task list",
      source: "- [ ] outer\n  - [x] inner one\n  - [ ] inner two",
    },
    {
      name: "loose list with a multi-paragraph item",
      source: "1. first paragraph\n\n   second paragraph\n\n2. item two",
    },
    {
      name: "nested list",
      source: "- outer\n  - inner one\n  - inner two",
    },
    {
      name: "blockquote",
      source: "> quoted *text*\n>\n> second paragraph",
    },
    {
      name: "fenced blockquote",
      source: [
        "::: {.blockquote}",
        "quoted *text*",
        "",
        "second paragraph",
        ":::",
      ].join("\n"),
    },
    {
      name: "fenced code with language",
      source: "```python\nprint('hi')\n```",
    },
    {
      name: "fenced code without language",
      source: "```\nplain\n```",
    },
    {
      name: "table with mixed alignments",
      source: "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |",
    },
    {
      name: "header-only table",
      source: "| a | b |\n| --- | --- |",
    },
    {
      name: "ragged table with extra body cell",
      source: "| a | b |\n| --- | --- |\n| 1 | 2 | 3 |",
    },
    {
      name: "ragged table with missing body cell",
      source: "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |",
    },
    {
      name: "horizontal rule between paragraphs",
      source: "before\n\n---\n\nafter",
    },
    {
      name: "numbered theorem block with title",
      source: [
        '::: {.theorem #thm:a title="Main"}',
        "Body text.",
        ":::",
        "",
        "See [@thm:a].",
      ].join("\n"),
    },
    {
      name: "fenced block key-value attributes",
      source: [
        '::: {.theorem #thm:attrs title="Main" status="draft"}',
        "Body text.",
        ":::",
      ].join("\n"),
    },
    {
      name: "proof block with inline header",
      source: [
        "::: {.proof #proof:a}",
        "Proof body.",
        ":::",
        "",
        "After.",
      ].join("\n"),
    },
    {
      name: "proof block suppresses user title in header",
      source: [
        '::: {.proof #proof:title title="Main theorem"}',
        "Proof body.",
        ":::",
      ].join("\n"),
    },
  ])("$name", ({ source }) => {
    expect(previewSummary(source)).toEqual(readerSummary(source));
  });

  it("fenced div emits the same wrapper classes and id in both pipelines", () => {
    const source = '::: {.theorem #thm:a title="Main"}\nBody text.\n:::';

    const readerHost = document.createElement("div");
    readerHost.innerHTML = renderToHtml(source).html;
    const previewHost = document.createElement("div");
    renderPreviewBlockContentToDom(previewHost, source);

    const readerDiv = readerHost.querySelector("#thm\\:a");
    const previewDiv = previewHost.querySelector("#thm\\:a");
    expect(readerDiv).not.toBeNull();
    expect(previewDiv).not.toBeNull();
    // cf-doc-block-collapsible marks the reader's disclosure affordance;
    // previews are non-interactive and intentionally do not emit it.
    const readerClasses = [...(readerDiv?.classList ?? [])]
      .filter((cls) => cls !== "cf-doc-block-collapsible")
      .sort();
    expect([...(previewDiv?.classList ?? [])].sort()).toEqual(readerClasses);
    expect(previewDiv?.textContent).toContain("Body text.");
    expect(readerDiv?.textContent).toContain("Body text.");
  });

  it("preview footnote definitions use the shared footnote entry chrome", () => {
    const host = document.createElement("div");
    renderPreviewBlockContentToDom(
      host,
      "Intro[^note:1].\n\n[^note:1]: Footnote with **bold** and $x^2$.",
    );

    const entry = host.querySelector<HTMLElement>('[id="fn-note%3A1"]');
    expect(entry?.className).toBe("cf-bibliography-entry");
    expect(entry?.dataset.defFrom).toBe("17");
    expect(entry?.querySelector("sup")?.className).toBe("cf-bibliography-entry-number");
    expect(entry?.querySelector("sup")?.textContent).toBe("1");
    expect(entry?.querySelector("strong")?.className).toBe("cf-bold");
    expect(entry?.querySelector(".cf-doc-inline-math.cf-math-inline")?.getAttribute("aria-label")).toBe("x^2");
    expect(host.querySelector(".footnote")).toBeNull();
  });
});
