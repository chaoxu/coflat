import { describe, expect, it } from "vitest";

import { parseMarkdownSource } from "./parser";
import {
  blockquoteRenderPlan,
  headingRenderPlan,
  horizontalRuleRenderPlan,
  paragraphRenderPlan,
} from "./block-render-plan";

function firstParagraph(source: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || node.name !== "Paragraph") throw new Error("expected paragraph");
  return node;
}

function firstBlock(source: string, name: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || node.name !== name) throw new Error(`expected ${name}`);
  return node;
}

function firstHeading(source: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || !node.name.includes("Heading")) throw new Error("expected heading");
  return node;
}

describe("paragraphRenderPlan", () => {
  it("builds a shared inline fragment plan from trimmed paragraph content", () => {
    const source = "  Hello **world** and $x$  ";
    const plan = paragraphRenderPlan(source, firstParagraph(source), {
      sourceRanges: true,
    });

    expect(plan).toMatchObject({
      kind: "paragraph",
      sourceRange: { from: 2, to: source.length },
      contentRange: { from: 2, to: source.length - 2 },
      text: "Hello world and $x$",
      hasMath: true,
    });
    expect(plan.fragments).toEqual([
      { kind: "text", text: "Hello ", sourceRange: { from: 2, to: 8 } },
      {
        kind: "strong",
        children: [{ kind: "text", text: "world", sourceRange: { from: 10, to: 15 } }],
        sourceRange: { from: 8, to: 17 },
      },
      { kind: "text", text: " and ", sourceRange: { from: 17, to: 22 } },
      { kind: "math", latex: "x", raw: "$x$", sourceRange: { from: 22, to: 25 } },
    ]);
  });
});

describe("horizontalRuleRenderPlan", () => {
  it("carries the block source range", () => {
    const source = "---";
    expect(horizontalRuleRenderPlan(firstBlock(source, "HorizontalRule"))).toEqual({
      kind: "horizontal-rule",
      sourceRange: { from: 0, to: 3 },
    });
  });
});

describe("headingRenderPlan", () => {
  it("builds a shared inline fragment plan for closed ATX headings", () => {
    const source = "### Hello **world** {#sec:intro .unnumbered} ###";
    const plan = headingRenderPlan(source, firstHeading(source), {
      sourceRanges: true,
    });

    expect(plan).toMatchObject({
      kind: "heading",
      level: 3,
      sourceRange: { from: 0, to: source.length },
      rawContentRange: { from: 4, to: source.indexOf(" ###") },
      contentRange: { from: 4, to: source.indexOf(" {#") },
      attributes: {
        contentTo: source.indexOf(" {#"),
        id: "sec:intro",
        unnumbered: true,
      },
      text: "Hello world",
      hasMath: false,
    });
    expect(plan.fragments).toEqual([
      { kind: "text", text: "Hello ", sourceRange: { from: 4, to: 10 } },
      {
        kind: "strong",
        children: [{ kind: "text", text: "world", sourceRange: { from: 12, to: 17 } }],
        sourceRange: { from: 10, to: 19 },
      },
    ]);
  });

  it("builds a shared inline fragment plan for Setext headings", () => {
    const source = "Setext $x$\n----------";
    const plan = headingRenderPlan(source, firstHeading(source), {
      sourceRanges: true,
    });

    expect(plan).toMatchObject({
      kind: "heading",
      level: 2,
      sourceRange: { from: 0, to: source.length },
      rawContentRange: { from: 0, to: 10 },
      contentRange: { from: 0, to: 10 },
      attributes: null,
      text: "Setext $x$",
      hasMath: true,
    });
    expect(plan.fragments).toEqual([
      { kind: "text", text: "Setext ", sourceRange: { from: 0, to: 7 } },
      { kind: "math", latex: "x", raw: "$x$", sourceRange: { from: 7, to: 10 } },
    ]);
  });
});

describe("blockquoteRenderPlan", () => {
  it("keeps renderable children and drops quote markers", () => {
    const source = "> **quoted**\n>\n> second";
    const plan = blockquoteRenderPlan(firstBlock(source, "Blockquote"));

    expect(plan.kind).toBe("blockquote");
    expect(plan.sourceRange).toEqual({ from: 0, to: source.length });
    expect(plan.children.map((child) => child.name)).toEqual(["Paragraph", "Paragraph"]);
    expect(plan.children.map((child) => source.slice(child.from, child.to))).toEqual([
      "**quoted**",
      "second",
    ]);
  });
});
