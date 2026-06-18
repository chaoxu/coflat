import { describe, expect, it } from "vitest";

import { parseMarkdownSource } from "./parser";
import { paragraphRenderPlan } from "./block-render-plan";

function firstParagraph(source: string) {
  const node = parseMarkdownSource(source, "html-render").topNode.firstChild;
  if (!node || node.name !== "Paragraph") throw new Error("expected paragraph");
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
