import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { frontmatterDecoration, frontmatterDecorationField } from "./frontmatter-render";
import { focusEffect } from "./focus-state";
import { frontmatterField } from "../state/frontmatter-state";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { type CslJsonItem } from "../../core/citations/csl-json";
import { CslProcessor } from "../citations/csl-processor";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { applyStateEffects, makeBibStore } from "../test-utils";

const karger: CslJsonItem = {
  id: "karger2000",
  type: "article-journal",
  author: [{ family: "Karger", given: "David R." }],
  title: "Minimum cuts in near-linear time",
  issued: { "date-parts": [[2000]] },
  "container-title": "JACM",
};

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterField, activeStructureEditField, frontmatterDecoration],
  });
}

function getArticleHeaderWidget(
  state: EditorState,
): {
  eq(other: unknown): boolean;
  toDOM(view?: EditorView): HTMLElement;
  updateDOM(dom: HTMLElement, view?: EditorView, from?: unknown): boolean;
} {
  const iter = state.field(frontmatterDecorationField).iter();
  const widget = iter.value?.spec.widget as {
    eq(other: unknown): boolean;
    toDOM(view?: EditorView): HTMLElement;
    updateDOM(dom: HTMLElement, view?: EditorView, from?: unknown): boolean;
  } | undefined;
  expect(widget).toBeDefined();
  if (!widget) {
    throw new Error("expected frontmatter article header widget");
  }
  return widget;
}

describe("frontmatterDecoration", () => {
  it("creates decoration hiding frontmatter", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const decos = state.field(frontmatterDecorationField);
    // Should have exactly one decoration range
    const iter = decos.iter();
    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(doc.indexOf("Content"));
    expect(iter.value?.spec.inclusiveEnd).toBe(false);
  });

  it("hides the blank separator after frontmatter in rich rendering", () => {
    const doc = "---\ntitle: Hello\n---\n\nContent";
    const state = createState(doc);
    const decos = state.field(frontmatterDecorationField);
    const iter = decos.iter();

    expect(iter.value).not.toBeNull();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(doc.indexOf("Content"));
  });

  it("creates no decorations when no frontmatter", () => {
    const state = createState("# No frontmatter");
    const decos = state.field(frontmatterDecorationField);
    const iter = decos.iter();
    expect(iter.value).toBeNull();
  });

  it("refreshes the title widget when math macros change but title text stays the same", () => {
    const originalDoc = [
      "---",
      "title: $\\R$",
      "math:",
      "  \\R: \\mathbb{R}",
      "---",
      "Content",
    ].join("\n");
    const state = createState(originalDoc);
    const oldWidget = getArticleHeaderWidget(state);

    const nextDoc = originalDoc.replace("\\mathbb{R}", "\\mathbf{R}");
    const tr = state.update({
      changes: { from: 0, to: originalDoc.length, insert: nextDoc },
    });
    const newWidget = getArticleHeaderWidget(tr.state);

    expect(oldWidget.eq(newWidget)).toBe(false);
  });

  it("maps the title widget through edits after frontmatter instead of rebuilding it", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const oldWidget = getArticleHeaderWidget(state);

    const tr = state.update({
      changes: { from: doc.length, insert: " more" },
    });
    const newWidget = getArticleHeaderWidget(tr.state);

    expect(newWidget).toBe(oldWidget);
  });

  it("keeps the title shell when the cursor enters frontmatter until structure edit activates", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = EditorState.create({
      doc,
      selection: { anchor: 5 },
      extensions: [frontmatterField, activeStructureEditField, frontmatterDecoration],
    });
    const iter = state.field(frontmatterDecorationField).iter();

    expect(iter.value?.spec.widget?.constructor?.name).toBe("ArticleHeaderWidget");
  });

  it("renders the frontmatter abstract in the article header widget", () => {
    const state = createState("---\ntitle: Hello\nabstract: |\n  Short $x^2$ abstract.\nabstract-title: Summary\n---\nContent");
    const widget = getArticleHeaderWidget(state);
    const dom = widget.toDOM();

    expect(dom.querySelector(".cf-doc-title")?.textContent).toContain("Hello");
    expect(dom.querySelector(".cf-doc-abstract-label")?.textContent).toBe("Summary");
    expect(dom.querySelector(".cf-doc-abstract-body")?.textContent).toContain("Short");
    expect(dom.querySelector(".cf-doc-abstract-body .katex")).not.toBeNull();
  });

  it("renders frontmatter abstract citations with local bibliography data", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\ntitle: Hello\nabstract: |\n  Cites [@karger2000].\n---\nContent",
        extensions: [
          frontmatterField,
          activeStructureEditField,
          bibDataField,
          frontmatterDecoration,
        ],
      }),
      parent,
    });
    const formatter = new CslProcessor([karger]);
    await formatter.ensureReady();
    view.dispatch({
      effects: bibDataEffect.of({
        store: makeBibStore([karger]),
        formatter,
      }),
    });
    const widget = getArticleHeaderWidget(view.state);
    const dom = widget.toDOM(view);

    const abstract = dom.querySelector(".cf-doc-abstract-body");
    expect(abstract?.textContent).toContain("[1]");
    expect(abstract?.textContent).not.toContain("karger2000");
    expect(abstract?.querySelector(".cf-citation")).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it("edits the frontmatter abstract through the article header widget", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: createState("---\ntitle: Hello\nabstract: |\n  Old $x^2$ abstract.\n---\nContent"),
      parent,
    });
    try {
      const widget = getArticleHeaderWidget(view.state);
      const dom = widget.toDOM(view);
      parent.appendChild(dom);
      const section = dom.querySelector<HTMLElement>(".cf-doc-abstract");
      const body = dom.querySelector<HTMLElement>(".cf-doc-abstract-body");
      expect(section).not.toBeNull();
      expect(body).not.toBeNull();
      expect(section?.getAttribute("aria-label")).toBe("Edit abstract");
      expect(section?.title).toBe("Edit abstract");
      section?.click();

      const editorDom = body?.querySelector<HTMLElement>(".cm-editor");
      expect(editorDom).not.toBeNull();
      if (!editorDom) throw new Error("expected abstract inline editor");
      expect(editorDom.classList.contains("cf-inline-editor")).toBe(true);
      expect(editorDom.querySelector(".katex")).not.toBeNull();

      const inlineView = EditorView.findFromDOM(editorDom);
      expect(inlineView).not.toBeNull();
      if (!inlineView) throw new Error("expected abstract inline EditorView");
      expect(inlineView.state.doc.toString()).toBe("Old $x^2$ abstract.");
      inlineView.dispatch({
        changes: {
          from: 0,
          to: inlineView.state.doc.length,
          insert: "New abstract.\nWith a second line.",
        },
      });
      inlineView.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        metaKey: true,
      }));

      expect(view.state.doc.toString()).toContain(
        "abstract: |\n  New abstract.\n  With a second line.\n",
      );
      expect(view.state.doc.toString()).not.toContain("Old abstract");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("keeps the abstract inline editor open across active shell refreshes", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: createState("---\ntitle: Hello\nabstract: |\n  Old $x^2$ abstract.\n---\nContent"),
      parent,
    });
    try {
      const widget = getArticleHeaderWidget(view.state);
      const dom = widget.toDOM(view);
      parent.appendChild(dom);
      const section = dom.querySelector<HTMLElement>(".cf-doc-abstract");
      const body = dom.querySelector<HTMLElement>(".cf-doc-abstract-body");
      section?.click();
      const editorDom = body?.querySelector<HTMLElement>(".cm-editor");
      expect(editorDom).not.toBeNull();

      const refreshedState = applyStateEffects(view.state, focusEffect.of(true));
      const refreshedWidget = getArticleHeaderWidget(refreshedState);
      expect(refreshedWidget.eq(widget)).toBe(true);
      expect(refreshedWidget.updateDOM(dom, view, widget)).toBe(true);

      expect(body?.classList.contains("cf-doc-abstract-editor")).toBe(true);
      expect(body?.querySelector(".cm-editor")).toBe(editorDom);
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("reveals raw YAML only when frontmatter structure edit is active", () => {
    const doc = "---\ntitle: Hello\n---\nContent";
    const state = createState(doc);
    const target = createStructureEditTargetAt(state, 0);
    expect(target).not.toBeNull();

    const active = applyStateEffects(
      state,
      setStructureEditTargetEffect.of(target),
    );
    const iter = active.field(frontmatterDecorationField).iter();

    expect(iter.value).not.toBeNull();
    expect(iter.value?.spec.widget).toBeUndefined();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(0);
  });
});
