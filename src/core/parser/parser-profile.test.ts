import { describe, expect, it } from "vitest";
import {
  coflatSharedMarkdownExtensions,
  getMarkdownParser,
  htmlRenderExtensions,
  markdownExtensions,
  parseMarkdownSource,
  semanticOnlyMarkdownExtensions,
} from "./index";

function nodeNames(source: string, mode: "semantic" | "html-render"): string[] {
  const names: string[] = [];
  parseMarkdownSource(source, mode).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

describe("Coflat parser profiles", () => {
  it("derives render and semantic profiles from one shared extension list", () => {
    expect(htmlRenderExtensions).toBe(coflatSharedMarkdownExtensions);
    expect(markdownExtensions).toBe(coflatSharedMarkdownExtensions);
    expect(semanticOnlyMarkdownExtensions).toEqual([]);
  });

  it("shares FORMAT.md syntax across semantic and HTML-render parser modes", () => {
    const source = [
      "::: {.theorem #thm:shared}",
      "Statement with $x^2$ and ==highlight==.",
      ":::",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "- [x] task",
    ].join("\n");

    for (const mode of ["semantic", "html-render"] as const) {
      const names = nodeNames(source, mode);
      expect(names).toContain("FencedDiv");
      expect(names).toContain("InlineMath");
      expect(names).toContain("Highlight");
      expect(names).toContain("Table");
      expect(names).toContain("TaskMarker");
    }
  });

  it("parses ordinary blockquotes in both semantic and HTML-render modes", () => {
    const source = "> authored Markdown quote";

    expect(nodeNames(source, "semantic")).toContain("Blockquote");
    expect(nodeNames(source, "html-render")).toContain("Blockquote");
  });

  it("reuses the configured parser instance for each mode", () => {
    expect(getMarkdownParser("semantic")).toBe(getMarkdownParser("semantic"));
    expect(getMarkdownParser("html-render")).toBe(getMarkdownParser("html-render"));
    expect(getMarkdownParser("semantic")).toBe(getMarkdownParser("html-render"));
  });
});
