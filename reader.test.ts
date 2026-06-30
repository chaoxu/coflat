import { describe, expect, it } from "vitest";

import {
  applyReaderSourceDecorations,
  applySourceRangeAttrs,
  closestMathSourceCarrier,
  closestSourceRangeCarrier,
  isSourceRangeCarrier,
  parseSourceOffset,
  renderedAnchorsForSourceLineRange,
  renderedAnchorsForSourceRange,
  renderedSourceAnchorsFromDom,
  renderToHtml,
  type SourceRange,
  scrollReaderToSourcePosition,
  sourceElementAtPosition,
  sourceLineRangeFromElement,
  sourceRangeAttrs,
  sourceRangeFromDataset,
  sourceRangeFromElement,
  sourceRangeFromValues,
} from "./reader";

describe("@chaoxu/coflat/reader public source-range helpers", () => {
  it("exposes source range parsing helpers", () => {
    const range: SourceRange | null = sourceRangeFromValues("3", "8");

    expect(range).toEqual({ from: 3, to: 8 });
    expect(parseSourceOffset("12px")).toBe(12);
    expect(sourceRangeFromValues("8", "3", { requirePositive: true })).toBeNull();
  });

  it("exposes dataset and element helpers for reader surfaces", () => {
    const outer = document.createElement("p");
    outer.dataset.sourceFrom = "5";
    outer.dataset.sourceTo = "15";
    const inner = document.createElement("span");
    outer.append(inner);

    expect(sourceRangeFromDataset(outer.dataset, "sourceFrom", "sourceTo")).toEqual({
      from: 5,
      to: 15,
    });
    expect(isSourceRangeCarrier(outer)).toBe(true);
    expect(sourceRangeFromElement(inner, { closest: true })).toEqual({ from: 5, to: 15 });
    expect(closestSourceRangeCarrier(inner)).toBe(outer);
  });

  it("exposes source range attribute writers", () => {
    const element = document.createElement("span");
    applySourceRangeAttrs(element, {
      sourceLine: 4,
      sourceRange: { from: 12, to: 18 },
    });

    expect(sourceRangeAttrs({ sourceLine: 4, sourceRange: { from: 12, to: 18 } })).toBe(
      ' data-source-line="4" data-source-from="12" data-source-to="18"',
    );
    expect(element.outerHTML).toBe(
      '<span data-source-line="4" data-source-from="12" data-source-to="18"></span>',
    );
  });

  it("renders a first-class source map with stable block anchors", () => {
    const source = "# Title\n\nBody **bold** text\n\n- item\n";
    const result = renderToHtml(source, undefined, { sourceMap: true });

    const heading = result.sourceMap?.find((anchor) => anchor.kind === "heading-1");
    const paragraph = result.sourceMap?.find((anchor) => anchor.kind === "paragraph");
    const listItem = result.sourceMap?.find((anchor) => anchor.kind === "list-item");
    const inline = result.sourceMap?.find((anchor) => anchor.granularity === "inline");

    expect(heading).toMatchObject({
      id: "cf-block-heading-1-0-7",
      granularity: "block",
      sourceRange: { from: 0, to: 7 },
      lineRange: { from: 1, to: 1 },
      selector: '[data-cf-anchor-id="cf-block-heading-1-0-7"]',
    });
    expect(paragraph?.lineRange).toEqual({ from: 3, to: 3 });
    expect(listItem?.kind).toBe("list-item");
    expect(inline?.sourceRange.from).toBeGreaterThanOrEqual(0);
    expect(result.html).toContain('data-cf-anchor-id="cf-block-heading-1-0-7"');
    expect(result.html).toContain('data-cf-block-kind="paragraph"');
  });

  it("looks up non-overlapping rendered anchors by source offset and line range", () => {
    const source = "# Title\n\nBody **bold** text\n\n- item\n";
    const result = renderToHtml(source, undefined, { sourceMap: true });
    const container = document.createElement("div");
    container.innerHTML = result.html;

    expect(renderedSourceAnchorsFromDom(container).map((anchor) => anchor.kind)).toEqual([
      "heading-1",
      "paragraph",
      "bullet-list",
      "list-item",
    ]);
    expect(renderedAnchorsForSourceRange(container, {
      from: source.indexOf("Body"),
      to: source.indexOf("text") + "text".length,
    }).map((anchor) => anchor.kind)).toEqual(["paragraph"]);
    expect(renderedAnchorsForSourceLineRange(container, { from: 5, to: 5 }).map((anchor) => anchor.kind)).toEqual([
      "list-item",
    ]);
    const sourceMappedParagraph = container.querySelector("p");
    expect(sourceMappedParagraph).not.toBeNull();
    if (!sourceMappedParagraph) return;
    expect(sourceLineRangeFromElement(sourceMappedParagraph)).toEqual({ from: 3, to: 3 });
  });

  it("applies host decorations and overlay slots to rendered source anchors", () => {
    const source = "# Title\n\nBody\n";
    const result = renderToHtml(source, undefined, { sourceMap: true });
    const container = document.createElement("div");
    container.innerHTML = result.html;

    const applied = applyReaderSourceDecorations(container, [{
      sourceLineRange: { from: 3, to: 3 },
      className: "is-changed",
      data: { diffStop: "1" },
      renderOverlay: () => {
        const button = document.createElement("button");
        button.textContent = "+";
        return button;
      },
    }]);

    expect(applied.map((anchor) => anchor.kind)).toEqual(["paragraph"]);
    const paragraph = container.querySelector("p");
    expect(paragraph).not.toBeNull();
    if (!paragraph) return;
    expect(paragraph.classList.contains("is-changed")).toBe(true);
    expect(paragraph.getAttribute("data-diff-stop")).toBe("1");
    expect(paragraph.nextElementSibling?.getAttribute("data-cf-anchor-overlay-for")).toBe(applied[0].id);
  });

  it("exposes math source carrier lookup", () => {
    const math = document.createElement("span");
    math.dataset.math = "x^2";
    const child = document.createElement("span");
    math.append(child);

    expect(closestMathSourceCarrier(child)).toBe(math);
  });

  it("finds the smallest rendered element for a source position", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <section data-source-from="0" data-source-to="40">
        <p data-source-from="10" data-source-to="20">
          <span data-source-from="12" data-source-to="16">body</span>
        </p>
      </section>
      <p data-source-from="50" data-source-to="60">tail</p>
    `;

    expect(sourceElementAtPosition(container, 13)?.tagName).toBe("SPAN");
    expect(sourceElementAtPosition(container, 45)?.textContent?.trim()).toBe("tail");
  });

  it("prefers the carrier starting at a source boundary over the previous carrier ending there", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-source-from="39" data-source-to="40">blank</div>
      <li data-source-from="40" data-source-to="76">item</li>
    `;

    expect(sourceElementAtPosition(container, 40)?.tagName).toBe("LI");
  });

  it("scrolls to a rendered source position when source positions are present", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p data-source-from="10" data-source-to="20">target</p>';
    const target = container.querySelector<HTMLElement>("p");
    if (!target) throw new Error("missing test target");
    let called = false;
    target.scrollIntoView = () => {
      called = true;
    };

    expect(scrollReaderToSourcePosition(container, { pos: 12 })).toBe(true);
    expect(called).toBe(true);
    expect(scrollReaderToSourcePosition(document.createElement("div"), 12)).toBe(false);
  });
});
