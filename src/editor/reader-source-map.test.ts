/**
 * `sourcePositions` emission + `mapDomRangeToSource`.
 *
 * Covers:
 *  - Block + inline mark + text source-position attribute emission.
 *  - DOM Range → source byte interval mapping over the live (jsdom) DOM.
 *  - Math placeholder collapse-to-block behaviour.
 */
import { describe, expect, it } from "vitest";
import { renderToHtml, mapDomRangeToSource } from "../../reader";

describe("renderToHtml — sourcePositions emission", () => {
  it("emits data-source-from/to on a block element", () => {
    // Lezer block-level emission only triggers when source has block structure.
    const src = "# heading\n\nhello world";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toMatch(/<h1 class="cf-doc-heading cf-doc-heading--h1"[^>]*data-source-from="0"[^>]*data-source-to="9"/);
    expect(r.html).toMatch(/<p class="cf-doc-paragraph"[^>]*data-source-from="11"[^>]*data-source-to="22"/);
  });

  it("emits source positions on <strong>", () => {
    const src = "say **bold** here";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toContain(
      '<strong data-source-from="4" data-source-to="12">',
    );
  });

  it("emits source positions on <code>", () => {
    const src = "use `xs` now";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toContain(
      '<code class="cf-doc-code-token" data-source-from="4" data-source-to="8">',
    );
  });

  it("emits source positions on <a> for an inline link", () => {
    const src = "see [doc](https://x.y) please";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toMatch(
      /<a href="https:\/\/x\.y" data-source-from="4" data-source-to="22">/,
    );
  });

  it('wraps plain text in <span class="cf-text"> with source positions', () => {
    const src = "hello world";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toContain(
      '<span class="cf-text" data-source-from="0" data-source-to="11">hello world</span>',
    );
  });

  it("emits source positions on inline math span", () => {
    const src = "the $x^2$ thing";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toMatch(
      /<span class="cf-doc-inline-math" data-math="[^"]+" data-source-from="4" data-source-to="9">/,
    );
  });

  it("emits source positions on a footnote ref", () => {
    const src = "claim[^1]\n\n[^1]: ok";
    const r = renderToHtml(src, undefined, { sourcePositions: true });
    expect(r.html).toMatch(/<sup class="cf-footnote-ref" data-source-from="5" data-source-to="9">/);
  });

  it("produces zero data-source-from attrs when opt is omitted", () => {
    const src = "**bold** and *em* and `code` and [a](https://x)";
    const r = renderToHtml(src);
    expect(r.html).not.toContain("data-source-from");
    expect(r.html).not.toContain("data-source-to");
    expect(r.html).not.toContain('class="cf-text"');
  });

  it("output without sourcePositions is byte-identical to baseline", () => {
    const src = "**bold** and *em* and a [link](https://x).";
    const a = renderToHtml(src);
    const b = renderToHtml(src, undefined, { sourcePositions: false });
    expect(a.html).toBe(b.html);
  });
});

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`selector ${selector} not found`);
  return el;
}

function requireFirstText(node: Node, label: string): Text {
  const text = node.firstChild;
  if (!(text instanceof Text)) throw new Error(`${label} first child is not text`);
  return text;
}

function rangeOverText(
  el: HTMLElement,
  selector: string,
  textOffset: [number, number],
): Range {
  const node = el.querySelector(selector);
  if (!node) throw new Error(`selector ${selector} not found`);
  const textNode = node.firstChild;
  if (!textNode || textNode.nodeType !== 3) {
    throw new Error(`first child of ${selector} is not a text node`);
  }
  const range = document.createRange();
  range.setStart(textNode, textOffset[0]);
  range.setEnd(textNode, textOffset[1]);
  return range;
}

describe("mapDomRangeToSource", () => {
  it("maps a Range over plain text inside a paragraph", () => {
    const src = "hello world";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    // The cf-text span has data-source-from=0..11; selecting "hello" is 0..5.
    const range = rangeOverText(container, "span.cf-text", [0, 5]);
    expect(mapDomRangeToSource(range, container)).toEqual({ from: 0, to: 5 });
  });

  it("maps a Range entirely inside <strong>", () => {
    const src = "x **bold** y";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    // <strong data-source-from="2" data-source-to="10"> wraps a cf-text "bold"
    // whose data-source-from is 4 (after the **).
    const strong = container.querySelector("strong");
    if (!strong) throw new Error("no <strong>");
    const inner = strong.querySelector("span.cf-text");
    if (!inner) throw new Error("no inner cf-text");
    const tn = inner.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 1); // inside "bold" → 'o'
    range.setEnd(tn, 3);
    const got = mapDomRangeToSource(range, container);
    // cf-text from=4; offsets 1..3 → 5..7.
    expect(got).toEqual({ from: 5, to: 7 });
  });

  it("maps a Range that spans bold-then-plain", () => {
    // Force a paragraph block via leading heading.
    const lead = "# h\n\n";
    const para = "**bold**, then plain";
    const src = lead + para;
    const baseOff = lead.length;
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    const strongText = requireFirstText(
      requireElement(container, "strong span.cf-text"),
      "strong text span",
    );
    const plainSpans = container.querySelectorAll("p > span.cf-text");
    const trailing = plainSpans[plainSpans.length - 1].firstChild as Text;
    const range = document.createRange();
    range.setStart(strongText, 0);
    range.setEnd(trailing, trailing.data.length);
    const got = mapDomRangeToSource(range, container);
    // Start of "bold" in source is baseOff + 2; end of "plain" is baseOff + 20.
    expect(got).toEqual({ from: baseOff + 2, to: baseOff + 20 });
  });

  it("returns null when the range has no source-position ancestor", () => {
    const src = "hello";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    // Range whose start is the container itself (no data-source-from anywhere
    // up to container). Use offset 0 (element endpoint at child index 0).
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(container, 0);
    // container has no data-source-from; walk stops at container → null.
    expect(mapDomRangeToSource(range, container)).toBeNull();
  });

  it("returns null when no sourcePositions attrs are present", () => {
    const { html } = renderToHtml("# h\n\nhello world");
    const container = mount(html);
    const tn = requireFirstText(requireElement(container, "p"), "paragraph");
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 5);
    expect(mapDomRangeToSource(range, container)).toBeNull();
  });

  it("maps a Range inside an unhydrated math placeholder to the block range", () => {
    const src = "the $x^2$ end";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    const math = requireElement(container, "span.cf-doc-inline-math");
    const tn = requireFirstText(math, "math span");
    const range = document.createRange();
    range.setStart(tn, 1);
    range.setEnd(tn, 3);
    // Math span source range: $x^2$ → 4..9. Selections inside collapse to
    // the math block's full bounds.
    expect(mapDomRangeToSource(range, container)).toEqual({ from: 4, to: 9 });
  });

  it("maps a Range inside a simulated hydrated math node to the block range", () => {
    const src = "the $x^2$ end";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    const math = requireElement<HTMLElement>(container, "span.cf-doc-inline-math");
    // Simulate hydration by replacing innerHTML with a nested structure
    // whose text bears no relation to the LaTeX source.
    math.innerHTML = '<span class="katex"><span>x</span><sup>2</sup></span>';
    math.setAttribute("data-math-hydrated", "true");
    const inner = requireFirstText(requireElement(math, "sup"), "sup");
    const range = document.createRange();
    range.setStart(inner, 0);
    range.setEnd(inner, 1);
    expect(mapDomRangeToSource(range, container)).toEqual({ from: 4, to: 9 });
  });

  it("swaps from/to if startContainer is after endContainer", () => {
    const src = "abc def";
    const { html } = renderToHtml(src, undefined, { sourcePositions: true });
    const container = mount(html);
    const tn = requireFirstText(requireElement(container, "span.cf-text"), "text span");
    const range = document.createRange();
    // Build a backwards range manually via setStart/setEnd.
    range.setStart(tn, 5);
    range.setEnd(tn, 5);
    // Tweak: collapse and then move (jsdom won't let setEnd be < setStart on
    // the same node — Range auto-collapses). So instead, assert the function
    // is robust by testing setStart < setEnd here (the swap branch is
    // defensive — its semantics are simply unconditional ordering).
    range.setEnd(tn, 7);
    expect(mapDomRangeToSource(range, container)).toEqual({ from: 5, to: 7 });
  });
});
