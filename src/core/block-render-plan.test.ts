import { describe, expect, it } from "vitest";

import { parseMarkdownSource } from "./parser";
import {
  blockNodeRenderKind,
  blockquoteRenderPlan,
  codeBlockRenderPlan,
  documentRenderPlan,
  displayMathRenderPlan,
  fencedDivRenderPlan,
  footnoteDefinitionRenderPlan,
  headingRenderPlan,
  horizontalRuleRenderPlan,
  listRenderPlan,
  paragraphRenderPlan,
  tableRenderPlan,
} from "./block-render-plan";

function documentNode(source: string) {
  return parseMarkdownSource(source, "html-render").topNode;
}

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

describe("documentRenderPlan", () => {
  it("skips frontmatter and shares blank-line traversal for document emitters", () => {
    const source = "---\ntitle: T\n---\n\nFirst\n\nSecond\n";
    const plan = documentRenderPlan(source, documentNode(source));

    expect(plan.frontmatterEnd).toBe(source.indexOf("\n\nFirst") + 1);
    expect(plan.children.map((child) => child.node.name)).toEqual(["Paragraph", "Paragraph"]);
    expect(plan.children[0].blankBeforeRanges).toEqual([]);
    expect(plan.children[1].blankBeforeRanges.map((range) => source.slice(range.from, range.to))).toEqual([
      "\n",
    ]);
    expect(plan.trailingBlankRanges.map((range) => source.slice(range.from, range.to))).toEqual(["\n"]);
    expect(plan.topLevelRenderableCount).toBe(2);
  });

  it("accounts for reader-only leading blocks when deciding trailing blank lines", () => {
    const source = "Only paragraph\n";
    const withoutTitle = documentRenderPlan(source, documentNode(source));
    const withTitle = documentRenderPlan(source, documentNode(source), { leadingBlockCount: 1 });

    expect(withoutTitle.topLevelRenderableCount).toBe(1);
    expect(withoutTitle.trailingBlankRanges).toEqual([]);
    expect(withTitle.topLevelRenderableCount).toBe(2);
    expect(withTitle.trailingBlankRanges.map((range) => source.slice(range.from, range.to))).toEqual(["\n"]);
  });
});

describe("blockNodeRenderKind", () => {
  it("classifies block nodes once for reader and editor dispatch", () => {
    expect(blockNodeRenderKind("Document")).toBe("document");
    expect(blockNodeRenderKind("Paragraph")).toBe("paragraph");
    expect(blockNodeRenderKind("ATXHeading1")).toBe("heading");
    expect(blockNodeRenderKind("SetextHeading2")).toBe("heading");
    expect(blockNodeRenderKind("HorizontalRule")).toBe("horizontal-rule");
    expect(blockNodeRenderKind("DisplayMath")).toBe("display-math");
    expect(blockNodeRenderKind("FencedCode")).toBe("code-block");
    expect(blockNodeRenderKind("CodeBlock")).toBe("code-block");
    expect(blockNodeRenderKind("Blockquote")).toBe("blockquote");
    expect(blockNodeRenderKind("BulletList")).toBe("list");
    expect(blockNodeRenderKind("OrderedList")).toBe("list");
    expect(blockNodeRenderKind("Table")).toBe("table");
    expect(blockNodeRenderKind("FencedDiv")).toBe("fenced-div");
    expect(blockNodeRenderKind("FootnoteDef")).toBe("footnote-definition");
    expect(blockNodeRenderKind("HTMLBlock")).toBe("ignored");
    expect(blockNodeRenderKind("CommentBlock")).toBe("ignored");
    expect(blockNodeRenderKind("Frontmatter")).toBe("ignored");
    expect(blockNodeRenderKind("CustomContainer")).toBe("fallback");
  });
});

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

describe("displayMathRenderPlan", () => {
  it("extracts latex and optional equation labels for shared emitters", () => {
    const source = "$$\nx^2+y^2\n$$ {#eq:pythagoras}";
    const plan = displayMathRenderPlan(source, firstBlock(source, "DisplayMath"));

    expect(plan).toEqual({
      kind: "display-math",
      sourceRange: { from: 0, to: source.length },
      latex: "x^2+y^2",
      equationId: "eq:pythagoras",
    });
  });

  it("keeps unlabeled display math label-free", () => {
    const source = "\\[\na+b\n\\]";
    expect(displayMathRenderPlan(source, firstBlock(source, "DisplayMath"))).toEqual({
      kind: "display-math",
      sourceRange: { from: 0, to: source.length },
      latex: "a+b",
      equationId: null,
    });
  });
});

describe("codeBlockRenderPlan", () => {
  it("captures fenced code language and code text", () => {
    const source = "```ts\nconst x = 1;\n```";
    const plan = codeBlockRenderPlan(source, firstBlock(source, "FencedCode"));

    expect(plan).toEqual({
      kind: "code-block",
      sourceRange: { from: 0, to: source.length },
      contentRange: { from: source.indexOf("const"), to: source.indexOf("\n```") },
      language: "ts",
      code: "const x = 1;",
    });
  });

  it("handles tilde fences and trims only fence-adjacent newlines", () => {
    const source = "~~~ haskell\n\nmain = putStrLn \"hi\"\n\n~~~";
    const plan = codeBlockRenderPlan(source, firstBlock(source, "FencedCode"));

    expect(plan.language).toBe("haskell");
    expect(plan.code).toBe('\nmain = putStrLn "hi"\n');
  });

  it("keeps empty fenced code blocks empty", () => {
    const source = "```txt\n```";
    const plan = codeBlockRenderPlan(source, firstBlock(source, "FencedCode"));

    expect(plan).toMatchObject({
      language: "txt",
      code: "",
    });
  });

});

describe("footnoteDefinitionRenderPlan", () => {
  it("captures id, body range, shared inline fragments, and math state", () => {
    const source = "[^note:1]: Footnote with **bold** and $x^2$.";
    const plan = footnoteDefinitionRenderPlan(source, firstBlock(source, "FootnoteDef"), {
      sourceRanges: true,
    });

    expect(plan).toMatchObject({
      kind: "footnote-definition",
      sourceRange: { from: 0, to: source.length },
      labelRange: { from: 0, to: 10 },
      bodyRange: { from: 11, to: source.length },
      id: "note:1",
      text: "Footnote with bold and $x^2$.",
      hasMath: true,
    });
    expect(plan?.fragments).toEqual([
      { kind: "text", text: "Footnote with ", sourceRange: { from: 11, to: 25 } },
      {
        kind: "strong",
        children: [{ kind: "text", text: "bold", sourceRange: { from: 27, to: 31 } }],
        sourceRange: { from: 25, to: 33 },
      },
      { kind: "text", text: " and ", sourceRange: { from: 33, to: 38 } },
      { kind: "math", latex: "x^2", raw: "$x^2$", sourceRange: { from: 38, to: 43 } },
      { kind: "text", text: ".", sourceRange: { from: 43, to: 44 } },
    ]);
  });

  it("trims body whitespace without changing the block source range", () => {
    const source = "[^a]:   body   ";
    const plan = footnoteDefinitionRenderPlan(source, firstBlock(source, "FootnoteDef"));

    expect(plan?.sourceRange).toEqual({ from: 0, to: source.length });
    expect(plan?.bodyRange).toEqual({ from: 8, to: 12 });
    expect(plan?.text).toBe("body");
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

describe("listRenderPlan", () => {
  it("captures ordered start, looseness, and item marker numbers", () => {
    const source = "3. first\n\n4. second";
    const plan = listRenderPlan(source, firstBlock(source, "OrderedList"));

    expect(plan).toMatchObject({
      kind: "list",
      sourceRange: { from: 0, to: source.length },
      ordered: true,
      loose: true,
      start: 3,
      task: false,
    });
    expect(plan.items.map((item) => item.markerNumber)).toEqual([3, 4]);
    expect(plan.items.map((item) => item.inlineOnly)).toEqual([true, true]);
    expect(plan.items.map((item) => item.children.map((child) => child.name))).toEqual([
      ["Paragraph"],
      ["Paragraph"],
    ]);
  });

  it("captures task marker state and task content range", () => {
    const source = "- [x] done **now**";
    const plan = listRenderPlan(source, firstBlock(source, "BulletList"));
    const item = plan.items[0];

    expect(plan).toMatchObject({
      ordered: false,
      loose: false,
      start: 1,
      task: true,
    });
    expect(item).toMatchObject({
      markerNumber: 1,
      inlineOnly: true,
      task: { checked: true },
    });
    expect(item.children.map((child) => child.name)).toEqual(["Task"]);
    expect(item.task).not.toBeNull();
    expect(source.slice(item.task?.markerRange.from, item.task?.markerRange.to)).toBe("[x]");
    expect(source.slice(item.task?.contentRange.from, item.task?.contentRange.to).trim()).toBe(
      "done **now**",
    );
    expect(item.task?.contentMarkdown).toBe("done **now**");
    expect(item.task?.trimmedContentRange).toEqual({
      from: source.indexOf("done"),
      to: source.length,
    });
  });

  it("normalizes task item content once for both reader and editor emitters", () => {
    const source = "- [ ]   padded task  ";
    const plan = listRenderPlan(source, firstBlock(source, "BulletList"));
    const task = plan.items[0].task;

    expect(task).not.toBeNull();
    expect(source.slice(task?.contentRange.from, task?.contentRange.to)).toBe("  padded task  ");
    expect(task?.contentMarkdown).toBe("padded task");
    expect(task?.trimmedContentRange).toEqual({
      from: source.indexOf("padded"),
      to: source.indexOf("task") + "task".length,
    });
  });

  it("keeps nested list children for the emitters", () => {
    const source = "- parent\n  - child";
    const plan = listRenderPlan(source, firstBlock(source, "BulletList"));

    expect(plan.items[0].inlineOnly).toBe(false);
    expect(plan.items[0].children.map((child) => child.name)).toEqual([
      "Paragraph",
      "BulletList",
    ]);
  });
});

describe("fencedDivRenderPlan", () => {
  it("captures attributes, title, primary class, and presentation label", () => {
    const source = '::: {.note .theorem #thm:main title="Main" status="draft"}\nBody\n:::';
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"), {
      displayTitleForBlockType: (blockType) => blockType === "theorem" ? "Theorem" : blockType,
      numberForBlockType: () => 2,
    });

    expect(plan).toMatchObject({
      kind: "fenced-div",
      sourceRange: { from: 0, to: source.length },
      classes: ["note", "theorem"],
      id: "thm:main",
      keyValues: { title: "Main", status: "draft" },
      title: "Main",
      isSelfClosing: false,
      primaryClassName: "theorem",
      displayTitle: "Theorem",
      number: 2,
      presentation: {
        label: "Theorem 2",
        title: "Main",
        showTitleInHeader: true,
      },
    });
    expect(plan.primaryManifestEntry?.name).toBe("theorem");
    expect(source.slice(plan.bodyRange?.from, plan.bodyRange?.to).trim()).toBe("Body");
    expect(plan.children.map((child) => child.node.name)).toEqual(["Paragraph"]);
  });

  it("uses inline fenced-div titles", () => {
    const source = "::: {.theorem} Inline\nBody\n:::";
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"));

    expect(plan.title).toBe("Inline");
  });

  it("uses title attributes when there is no inline title", () => {
    const source = '::: {.theorem title="Attr"}\nBody\n:::';
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"));

    expect(plan.title).toBe("Attr");
  });

  it("plans fenced-div title inline fragments once for reader and editor emitters", () => {
    const source = '::: {.theorem title="**Main** `case`"}\nBody\n:::';
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"));

    expect(plan.title).toBe("**Main** `case`");
    expect(plan.titleText).toBe("Main case");
    expect(plan.titleHasMath).toBe(false);
    expect(plan.titleFragments.map((fragment) => fragment.kind)).toEqual([
      "strong",
      "text",
      "code",
    ]);
  });

  it("records blank-line ranges before renderable body children", () => {
    const source = "::: {.proof}\nfirst\n\nsecond\n:::";
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"));

    expect(plan.children.map((child) => child.node.name)).toEqual(["Paragraph", "Paragraph"]);
    expect(plan.children[0].blankBeforeRanges).toEqual([]);
    expect(plan.children[1].blankBeforeRanges).toEqual([{
      from: source.indexOf("\n\n") + 1,
      to: source.indexOf("\n\n") + 2,
    }]);
  });

  it("keeps canonical multiline fenced divs non-self-closing", () => {
    const source = '::: {.theorem title="Only"}\n:::';
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"));

    expect(plan.isSelfClosing).toBe(false);
    expect(plan.children).toEqual([]);
    expect(plan.bodyRange).toBeNull();
  });
});

describe("tableRenderPlan", () => {
  it("captures header, body rows, cells, and alignments", () => {
    const source = [
      "| Left | Center | Right |",
      "| :--- | :----: | ----: |",
      "| $x$  | text   | `z`   |",
    ].join("\n");
    const plan = tableRenderPlan(source, firstBlock(source, "Table"));

    expect(plan).toMatchObject({
      kind: "table",
      sourceRange: { from: 0, to: source.length },
      alignments: ["left", "center", "right"],
      header: {
        kind: "table-row",
        header: true,
      },
      rows: [{ kind: "table-row", header: false }],
    });
    expect(plan.header?.cells.map((cell) => source.slice(cell.node.from, cell.node.to))).toEqual([
      "Left",
      "Center",
      "Right",
    ]);
    expect(plan.rows[0].cells.map((cell) => cell.align)).toEqual(["left", "center", "right"]);
    expect(plan.rows[0].cells.map((cell) => source.slice(cell.node.from, cell.node.to))).toEqual([
      "$x$",
      "text",
      "`z`",
    ]);
    expect(plan.rows[0].cells.map((cell) => cell.text)).toEqual(["$x$", "text", "z"]);
    expect(plan.rows[0].cells.map((cell) => cell.hasMath)).toEqual([true, false, false]);
  });

  it("plans table cell inline fragments once for both reader and editor emitters", () => {
    const source = "| Ref | Math |\n| --- | --- |\n| **bold** [@thm:a] | $x$ |";
    const plan = tableRenderPlan(source, firstBlock(source, "Table"), {
      sourceRanges: true,
    });
    const [refCell, mathCell] = plan.rows[0].cells;

    expect(refCell.text).toBe("bold [@thm:a]");
    expect(refCell.fragments.map((fragment) => fragment.kind)).toEqual([
      "strong",
      "text",
      "reference",
    ]);
    expect(refCell.fragments[0]).toMatchObject({
      kind: "strong",
      sourceRange: { from: source.indexOf("**bold**"), to: source.indexOf(" [@thm:a]") },
    });
    expect(mathCell.hasMath).toBe(true);
    expect(mathCell.fragments).toEqual([
      {
        kind: "math",
        latex: "x",
        raw: "$x$",
        sourceRange: {
          from: source.lastIndexOf("$x$"),
          to: source.lastIndexOf("$x$") + "$x$".length,
        },
      },
    ]);
  });

  it("keeps header-only tables without inventing body rows", () => {
    const source = "| A | B |\n|---|---|";
    const plan = tableRenderPlan(source, firstBlock(source, "Table"));

    expect(plan.header?.cells).toHaveLength(2);
    expect(plan.rows).toEqual([]);
  });

  it("keeps ragged row cell counts as parsed", () => {
    const source = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 | 3 |",
      "| 4 |",
    ].join("\n");
    const plan = tableRenderPlan(source, firstBlock(source, "Table"));

    expect(plan.header?.cells).toHaveLength(2);
    expect(plan.rows.map((row) => row.cells.length)).toEqual([3, 1]);
  });
});
