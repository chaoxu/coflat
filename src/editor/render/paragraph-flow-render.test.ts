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
    .filter((spec) => spec.widgetClass === "ParagraphFlowWidget");
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
});
