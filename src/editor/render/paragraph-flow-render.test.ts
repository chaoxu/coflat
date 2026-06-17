import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
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

  it("skips reference-bearing paragraphs until full-document reference rendering is wired", () => {
    const doc = "See [@thm:main]\nfor the main result.\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([]);
  });

  it("does not replace list item paragraphs", () => {
    const doc = "- first source line\n  second source line\n\nnext";
    const target = createParagraphFlowView(doc, doc.length);

    expect(paragraphFlowSpecs(target)).toEqual([]);
  });
});
