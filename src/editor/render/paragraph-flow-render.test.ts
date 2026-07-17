import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration, DecorationSet } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { bibDataField } from "../state/bib-data";
import { blockCounterField } from "../state/block-counter";
import {
  activeStructureEditField,
} from "../state/cm-structure-edit";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { createPluginRegistryField } from "../state/plugin-registry";
import { 
  createTestView,
  getDecorationSpecs,makeBlockPlugin, } from "../test-utils";
import { focusEffect } from "./focus-state";
import {
  _paragraphFlowFieldForTest,
  paragraphFlowRenderPlugin,
} from "./paragraph-flow-render";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createParagraphFlowView(doc: string, cursorPos = doc.length): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      paragraphFlowRenderPlugin,
    ],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

function createReferenceAwareParagraphFlowView(doc: string, cursorPos = doc.length): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      activeStructureEditField,
      documentAnalysisField,
      mathMacrosField,
      bibDataField,
      createPluginRegistryField([
        makeBlockPlugin({ name: "theorem", counter: "theorem", title: "Theorem" }),
      ]),
      blockCounterField,
      paragraphFlowRenderPlugin,
    ],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

function paragraphFlowSpecs(target: EditorView) {
  return getDecorationSpecs(target.state.field(_paragraphFlowFieldForTest).decorations)
    .filter((spec) => spec.widgetClass === "ParagraphFlowWidget" || spec.widgetClass === "BlockquoteFlowWidget");
}

function decorationEntries(set: DecorationSet) {
  const entries: { from: number; to: number; value: Decoration }[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    entries.push({ from: cursor.from, to: cursor.to, value: cursor.value });
    cursor.next();
  }
  return entries;
}

describe("paragraph flow render", () => {
  it("replaces an inactive top-level soft-break paragraph with one block widget", () => {
    const doc = "first source line\nsecond source line\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({
        from: 0,
        to: "first source line\nsecond source line".length,
        block: true,
      }),
    ]);
    const paragraph = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget .cf-doc-paragraph");
    expect(paragraph?.textContent).toContain("first source line");
    expect(paragraph?.dataset.sourceFrom).toBe("0");
    expect(paragraph?.dataset.sourceTo).toBe(String("first source line\nsecond source line".length));
  });

  it("reveals source for the active paragraph", () => {
    const doc = "first source line\nsecond source line\n\nnext";
    const target = createParagraphFlowView(doc, doc.indexOf("second"));

    expect(paragraphFlowSpecs(target)).toEqual([]);
  });

  it("emits full-document source ranges for rendered inline paragraph content", () => {
    const doc = [
      "# Title",
      "",
      "Lead **bold text** and [link text](https://example.com) include $x^2$ math.",
      "continued paragraph text for flow rendering.",
      "",
      "next",
    ].join("\n");
    const target = createParagraphFlowView(doc, doc.length);

    const boldText = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget strong .cf-text");
    expect(boldText?.dataset.sourceFrom).toBe(String(doc.indexOf("bold text")));
    expect(boldText?.dataset.sourceTo).toBe(String(doc.indexOf("bold text") + "bold text".length));

    const linkText = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget a .cf-text");
    expect(linkText?.dataset.sourceFrom).toBe(String(doc.indexOf("link text")));
    expect(linkText?.dataset.sourceTo).toBe(String(doc.indexOf("link text") + "link text".length));

    const math = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget .cf-doc-inline-math");
    expect(math?.dataset.sourceFrom).toBe(String(doc.indexOf("$x^2$")));
    expect(math?.dataset.sourceTo).toBe(String(doc.indexOf("$x^2$") + "$x^2$".length));
    expect(math?.dataset.sourceAtomic).toBe("true");
  });

  it("updates paragraph-flow widgets when the cursor moves between paragraphs", () => {
    const first = "first source line\nsecond source line";
    const second = "third source line\nfourth source line";
    const doc = `${first}\n\n${second}`;
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({ from: 0, to: first.length }),
    ]);

    target.dispatch({ selection: { anchor: doc.indexOf("second") } });
    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({
        from: first.length + 2,
        to: doc.length,
      }),
    ]);

    target.dispatch({ selection: { anchor: doc.length } });
    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({ from: 0, to: first.length }),
    ]);
  });

  it("exposes paragraph-flow replacements as atomic ranges", () => {
    const doc = "first source line\nsecond source line\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);
    let atomicRangeCount = 0;

    for (const provider of target.state.facet(EditorView.atomicRanges)) {
      provider(target).between(0, doc.length, () => {
        atomicRangeCount++;
      });
    }

    expect(atomicRangeCount).toBeGreaterThan(0);
  });

  it("renders reference-bearing paragraphs with full-document reference labels", () => {
    const doc = [
      "::: {.theorem #thm:main}",
      "Statement.",
      ":::",
      "",
      "See [@thm:main]",
      "for the main result.",
      "",
      "next",
    ].join("\n");
    const paragraphStart = doc.indexOf("See [@thm:main]");
    const target = createReferenceAwareParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({
        from: paragraphStart,
        to: paragraphStart + "See [@thm:main]\nfor the main result.".length,
        block: true,
      }),
    ]);
    const paragraph = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget .cf-doc-paragraph");
    expect(paragraph?.textContent?.replace(/\s+/g, " ")).toContain("See Theorem 1 for the main result.");
    expect(paragraph?.textContent).not.toContain("[@thm:main]");
    const reference = target.dom.querySelector<HTMLElement>(".cf-paragraph-flow-widget [data-reference-widget]");
    const referenceStart = doc.indexOf("[@thm:main]");
    expect(reference?.dataset.sourceFrom).toBe(String(referenceStart));
    expect(reference?.dataset.sourceTo).toBe(String(referenceStart + "[@thm:main]".length));
    expect(reference?.dataset.sourceAtomic).toBe("true");
  });

  it("does not replace list item paragraphs", () => {
    const doc = "- first source line\n  second source line\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([]);
  });

  it("replaces an inactive top-level blockquote with the shared preview blockquote surface", () => {
    const doc = "> quoted *text*\n>\n> $$\n> x^2\n> $$\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({
        from: 0,
        to: doc.indexOf("\n\nnext"),
        block: true,
        widgetClass: "BlockquoteFlowWidget",
      }),
    ]);
    const blockquote = target.dom.querySelector<HTMLElement>(".cf-blockquote-flow-widget .cf-doc-blockquote");
    expect(blockquote?.textContent?.replace(/\s+/g, " ")).toContain("quoted text");
    expect(blockquote?.dataset.sourceFrom).toBe("0");
    expect(blockquote?.dataset.sourceTo).toBe(String(doc.indexOf("\n\nnext")));
  });

  it("reveals source for the active blockquote", () => {
    const doc = "> quoted *text*\n>\n> second paragraph\n\nnext";
    const target = createParagraphFlowView(doc, doc.indexOf("second"));

    expect(paragraphFlowSpecs(target)).toEqual([]);
  });

  it("re-renders a flow blockquote when the caret leaves it", () => {
    const doc = "> quoted *text*\n>\n> second paragraph\n\nnext";
    const target = createParagraphFlowView(doc, doc.indexOf("second"));
    expect(paragraphFlowSpecs(target)).toEqual([]);

    target.dispatch({ selection: { anchor: doc.length } });

    expect(paragraphFlowSpecs(target)).toEqual([
      expect.objectContaining({
        from: 0,
        to: doc.indexOf("\n\nnext"),
        widgetClass: "BlockquoteFlowWidget",
      }),
    ]);
  });

  it("keeps the field value identical when a caret move changes no block overlap", () => {
    const first = "first source line\nsecond source line";
    const doc = `${first}\n\nnext plain`;
    const target = createParagraphFlowView(doc, doc.length);
    const before = target.state.field(_paragraphFlowFieldForTest);
    expect(getDecorationSpecs(before.decorations)).toHaveLength(1);

    target.dispatch({ selection: { anchor: doc.length - 2 } });

    expect(target.state.field(_paragraphFlowFieldForTest)).toBe(before);
  });

  it("removes only the entered paragraph's widget and keeps the neighbour's decoration identity", () => {
    const first = "first source line\nsecond source line";
    const second = "third source line\nfourth source line";
    const doc = `${first}\n\n${second}\n\nnext`;
    const target = createParagraphFlowView(doc, doc.length);
    const entriesBefore = decorationEntries(target.state.field(_paragraphFlowFieldForTest).decorations);
    expect(entriesBefore).toHaveLength(2);

    target.dispatch({ selection: { anchor: doc.indexOf("first") + 2 } });

    const entriesAfter = decorationEntries(target.state.field(_paragraphFlowFieldForTest).decorations);
    expect(entriesAfter).toHaveLength(1);
    expect(entriesAfter[0].from).toBe(first.length + 2);
    expect(entriesAfter[0].value).toBe(entriesBefore[1].value);
  });

  it("reveals every block touched by a multi-range selection", () => {
    const first = "first source line\nsecond source line";
    const second = "third source line\nfourth source line";
    const doc = `${first}\n\n${second}\n\nnext`;
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [
        markdown({ extensions: markdownExtensions }),
        EditorState.allowMultipleSelections.of(true),
        paragraphFlowRenderPlugin,
      ],
    });
    view.dispatch({ effects: focusEffect.of(true) });
    expect(paragraphFlowSpecs(view)).toHaveLength(2);

    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("second")),
        EditorSelection.cursor(doc.indexOf("fourth")),
      ], 0),
    });
    expect(paragraphFlowSpecs(view)).toEqual([]);

    view.dispatch({ selection: { anchor: doc.length } });
    expect(paragraphFlowSpecs(view)).toHaveLength(2);
  });
});
