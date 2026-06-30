import { describe, expect, it } from "vitest";

import { parseMarkdownSource } from "./parser";
import {
  blockLineCost,
  blockNodeRenderKind,
  blockquoteRenderPlan,
  codeBlockRenderPlan,
  dispatchBlockNodeRender,
  documentRenderPlan,
  displayMathRenderPlan,
  emitBlockChildrenRenderPlan,
  emitDocumentRenderPlan,
  fencedDivRenderPlan,
  footnoteDefinitionRenderPlan,
  footnoteDefinitionSemanticPlan,
  headingRenderPlan,
  headingSemanticPlan,
  horizontalRuleRenderPlan,
  listItemEmissionPlan,
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

  it("emits document children, blanks, trailing blanks, and after hook in one shared order", () => {
    const source = "First\n\nSecond\n";
    const plan = documentRenderPlan(source, documentNode(source));
    const events: string[] = [];

    const emitted = emitDocumentRenderPlan(plan, {
      emitBlank: (range) => events.push(`blank:${source.slice(range.from, range.to)}`),
      emitChild: (childPlan) => {
        events.push(`child:${childPlan.node.from}-${childPlan.node.to}`);
        return childPlan.node.name;
      },
      emitTrailingBlank: (range) => events.push(`trailing:${source.slice(range.from, range.to)}`),
      afterDocument: () => events.push("after"),
    });

    expect(emitted).toEqual(["Paragraph", "Paragraph"]);
    expect(events).toEqual([
      "child:0-5",
      "blank:\n",
      "child:7-13",
      "trailing:\n",
      "after",
    ]);
  });

  it("emits nested block children and their blank ranges in one shared order", () => {
    const source = "::: {.remark}\nFirst\n\nSecond\n:::\n";
    const fencedDiv = firstBlock(source, "FencedDiv");
    const plan = fencedDivRenderPlan(source, fencedDiv);
    const events: string[] = [];

    const emitted = emitBlockChildrenRenderPlan(plan.children, {
      emitBlank: (range) => events.push(`blank:${source.slice(range.from, range.to)}`),
      emitChild: (childPlan) => {
        events.push(`child:${childPlan.node.from}-${childPlan.node.to}`);
        return childPlan.node.name;
      },
    });

    expect(emitted).toEqual(["Paragraph", "Paragraph"]);
    expect(events).toEqual([
      "child:13-19",
      "blank:\n",
      "child:21-27",
    ]);
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

  it("dispatches through the shared reader/editor block handler table", () => {
    const source = [
      "# Title",
      "",
      "Paragraph",
      "",
      "- item",
      "",
      "> quote",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "---",
      "",
      "$$",
      "x",
      "$$",
      "",
      "| a |",
      "| - |",
      "| b |",
      "",
      "::: {.theorem #thm}",
      "body",
      ":::",
      "",
      "[^a]: footnote",
      "",
      "<div>ignored</div>",
    ].join("\n");
    const seen: string[] = [];
    const handlers = {
      document: () => seen.push("document"),
      paragraph: () => seen.push("paragraph"),
      heading: () => seen.push("heading"),
      horizontalRule: () => seen.push("horizontal-rule"),
      displayMath: () => seen.push("display-math"),
      codeBlock: () => seen.push("code-block"),
      blockquote: () => seen.push("blockquote"),
      list: () => seen.push("list"),
      table: () => seen.push("table"),
      fencedDiv: () => seen.push("fenced-div"),
      footnoteDefinition: () => seen.push("footnote-definition"),
      ignored: () => seen.push("ignored"),
      fallback: () => seen.push("fallback"),
    };
    const root = documentNode(source);
    dispatchBlockNodeRender(root, handlers);
    let child = root.firstChild;
    while (child) {
      dispatchBlockNodeRender(child, handlers);
      child = child.nextSibling;
    }

    expect(seen).toEqual([
      "document",
      "heading",
      "paragraph",
      "list",
      "blockquote",
      "code-block",
      "horizontal-rule",
      "display-math",
      "table",
      "fenced-div",
      "footnote-definition",
      "ignored",
    ]);
  });
});

describe("blockLineCost", () => {
  it("counts simple atomic block costs for shared truncation planning", () => {
    expect(blockLineCost("Paragraph", firstBlock("Paragraph", "Paragraph"))).toBe(1);
    expect(blockLineCost("# Heading", firstHeading("# Heading"))).toBe(1);
    expect(blockLineCost("---", firstBlock("---", "HorizontalRule"))).toBe(1);
    expect(blockLineCost("$$\nx\n$$", firstBlock("$$\nx\n$$", "DisplayMath"))).toBe(1);
  });

  it("counts fenced code lines from the shared code block plan", () => {
    const source = "```ts\none\ntwo\nthree\n```";

    expect(blockLineCost(source, firstBlock(source, "FencedCode"))).toBe(3);
  });

  it("keeps empty fenced code blocks free for truncation budgets", () => {
    const source = "```ts\n```";

    expect(blockLineCost(source, firstBlock(source, "FencedCode"))).toBe(0);
  });

  it("counts list items and table rows from their shared render plans", () => {
    const list = "- one\n- two\n- three";
    const table = "| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |";

    expect(blockLineCost(list, firstBlock(list, "BulletList"))).toBe(3);
    expect(blockLineCost(table, firstBlock(table, "Table"))).toBe(3);
  });

  it("recurses through blockquotes and fenced div children", () => {
    const quote = "> # Heading\n>\n> paragraph";
    const div = "::: {.proof}\n# Heading\n\nparagraph\n:::\n";

    expect(blockLineCost(quote, firstBlock(quote, "Blockquote"))).toBe(2);
    expect(blockLineCost(div, firstBlock(div, "FencedDiv"))).toBe(3);
  });
});

describe("fencedDivRenderPlan", () => {
  it("uses the shared manifest class as primary even when it is not the first class", () => {
    const source = "::: {.highlight .theorem #thm:a}\nBody\n:::";
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"), {
      numberForFencedDiv: (block) => {
        expect(block).toMatchObject({
          primaryClass: "theorem",
          id: "thm:a",
        });
        return 7;
      },
      numberForBlockType: () => {
        throw new Error("numberForBlockType fallback should not be used");
      },
    });

    expect(plan.classes).toEqual(["highlight", "theorem"]);
    expect(plan.primaryClassName).toBe("theorem");
    expect(plan.presentation).toMatchObject({
      label: "theorem 7",
    });
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
  it("shares id, label range, and trimmed body range as a semantic plan", () => {
    const source = "[^note:1]:   Footnote body   ";
    const plan = footnoteDefinitionSemanticPlan(source, firstBlock(source, "FootnoteDef"));

    expect(plan).toEqual({
      kind: "footnote-definition",
      sourceRange: { from: 0, to: source.length },
      labelRange: { from: 0, to: 10 },
      bodyRange: { from: 13, to: 26 },
      id: "note:1",
    });
  });

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
        appendixBoundary: false,
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

  it("builds shared heading semantics from the same heading plan", () => {
    const source = "### Hello **world** {#sec:intro .unnumbered} ###";

    expect(headingSemanticPlan(source, firstHeading(source))).toEqual({
      from: 0,
      to: source.length,
      level: 3,
      textFrom: 4,
      textTo: source.indexOf(" {#"),
      text: "Hello world",
      id: "sec:intro",
      appendixBoundary: false,
      unnumbered: true,
    });
  });

  it("marks appendix heading attributes as unnumbered boundaries", () => {
    const source = "# Appendix {.appendix}";

    expect(headingSemanticPlan(source, firstHeading(source))).toEqual({
      from: 0,
      to: source.length,
      level: 1,
      textFrom: 2,
      textTo: source.indexOf(" {.appendix}"),
      text: "Appendix",
      id: undefined,
      appendixBoundary: true,
      unnumbered: true,
    });
  });

  it("only treats top-level appendix heading attributes as appendix boundaries", () => {
    const source = "## Appendix {.appendix}";

    expect(headingSemanticPlan(source, firstHeading(source))).toEqual({
      from: 0,
      to: source.length,
      level: 2,
      textFrom: 3,
      textTo: source.indexOf(" {.appendix}"),
      text: "Appendix",
      id: undefined,
      appendixBoundary: false,
      unnumbered: false,
    });
  });

  it("builds Setext heading semantics from the same heading plan", () => {
    const source = "Setext $x$ {#sec:x}\n----------";

    expect(headingSemanticPlan(source, firstHeading(source))).toEqual({
      from: 0,
      to: source.length,
      level: 2,
      textFrom: 0,
      textTo: source.indexOf(" {#"),
      text: "Setext $x$",
      id: "sec:x",
      appendixBoundary: false,
      unnumbered: false,
    });
  });
});

describe("blockquoteRenderPlan", () => {
  it("keeps renderable children and drops quote markers", () => {
    const source = "> **quoted**\n>\n> second";
    const plan = blockquoteRenderPlan(firstBlock(source, "Blockquote"));

    expect(plan.kind).toBe("blockquote");
    expect(plan.sourceRange).toEqual({ from: 0, to: source.length });
    expect(plan.children.map((child) => child.node.name)).toEqual(["Paragraph", "Paragraph"]);
    expect(plan.children.map((child) => child.blankBeforeRanges)).toEqual([[], []]);
    expect(plan.children.map((child) => source.slice(child.node.from, child.node.to))).toEqual([
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

  it("plans tight paragraph children for unwrapped list item emission", () => {
    const source = "- parent";
    const item = listRenderPlan(source, firstBlock(source, "BulletList")).items[0];

    expect(listItemEmissionPlan(item).map((child) => ({
      kind: child.kind,
      node: child.node.name,
      wrapTaskContent: child.wrapTaskContent,
    }))).toEqual([
      { kind: "inline-paragraph", node: "Paragraph", wrapTaskContent: false },
    ]);
  });

  it("plans nested list children as block emission", () => {
    const source = "- parent\n  - child";
    const item = listRenderPlan(source, firstBlock(source, "BulletList")).items[0];

    expect(listItemEmissionPlan(item).map((child) => ({
      kind: child.kind,
      node: child.node.name,
      wrapTaskContent: child.wrapTaskContent,
    }))).toEqual([
      { kind: "block", node: "Paragraph", wrapTaskContent: false },
      { kind: "block", node: "BulletList", wrapTaskContent: false },
    ]);
  });

  it("plans task item wrapping consistently for tight and loose items", () => {
    const tight = listRenderPlan("- [ ] task", firstBlock("- [ ] task", "BulletList")).items[0];
    const looseSource = "- [ ] task\n\n  more";
    const loose = listRenderPlan(looseSource, firstBlock(looseSource, "BulletList")).items[0];

    expect(listItemEmissionPlan(tight)[0]).toMatchObject({
      kind: "task",
      node: { name: "Task" },
      wrapTaskContent: false,
    });
    expect(listItemEmissionPlan(loose)[0]).toMatchObject({
      kind: "task",
      node: { name: "Task" },
      wrapTaskContent: true,
    });
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
      emission: {
        containerLayout: "disclosure",
        collapsibleBlock: true,
        interactiveBlock: false,
        showSelfClosingTitleParagraph: false,
        addQedToLastBodyBlock: false,
        showStandaloneTitle: false,
        showCaptionBelow: false,
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

  it("plans interactive disclosure layout for reader semantic blocks", () => {
    const source = "::: {.theorem}\nBody\n:::";
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"), {
      semanticBlockDisclosures: "interactive",
    });

    expect(plan.emission).toMatchObject({
      containerLayout: "disclosure",
      collapsibleBlock: true,
      interactiveBlock: true,
    });
  });

  it("plans inline-header layout for proof blocks", () => {
    const source = "::: {.proof}\nDone.\n:::";
    const plan = fencedDivRenderPlan(source, firstBlock(source, "FencedDiv"), {
      semanticBlockDisclosures: "interactive",
    });

    expect(plan.presentation?.hasInlineHeader).toBe(true);
    expect(plan.emission).toMatchObject({
      containerLayout: "inline-header",
      collapsibleBlock: false,
      interactiveBlock: false,
      addQedToLastBodyBlock: true,
    });
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
