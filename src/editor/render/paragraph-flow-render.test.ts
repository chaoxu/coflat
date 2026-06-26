import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { makeBlockPlugin } from "../test-utils";
import {
  activeStructureEditField,
} from "../state/cm-structure-edit";
import { bibDataField } from "../state/bib-data";
import { blockCounterField } from "../state/block-counter";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { createPluginRegistryField } from "../state/plugin-registry";
import {
  createTestView,
  getDecorationSpecs,
} from "../test-utils";
import {
  _paragraphFlowFieldForTest,
  paragraphFlowRenderPlugin,
} from "./paragraph-flow-render";
import { focusEffect } from "./focus-state";

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
  return getDecorationSpecs(target.state.field(_paragraphFlowFieldForTest))
    .filter((spec) => spec.widgetClass === "ParagraphFlowWidget" || spec.widgetClass === "BlockquoteFlowWidget");
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
});
