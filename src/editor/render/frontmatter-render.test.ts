import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { frontmatterDecoration, frontmatterDecorationField } from "./frontmatter-render";
import { frontmatterField } from "../state/frontmatter-state";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { applyStateEffects } from "../test-utils";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [frontmatterField, activeStructureEditField, frontmatterDecoration],
  });
}

function getArticleHeaderWidget(
  state: EditorState,
): { eq(other: unknown): boolean; toDOM(view?: EditorView): HTMLElement } {
  const iter = state.field(frontmatterDecorationField).iter();
  const widget = iter.value?.spec.widget as { eq(other: unknown): boolean; toDOM(): HTMLElement } | undefined;
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

  it("edits the frontmatter abstract through the article header widget", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: createState("---\ntitle: Hello\nabstract: |\n  Old abstract.\n---\nContent"),
      parent,
    });
    try {
      const widget = getArticleHeaderWidget(view.state);
      const dom = widget.toDOM(view);
      const body = dom.querySelector<HTMLElement>(".cf-doc-abstract-body");
      expect(body).not.toBeNull();
      body?.click();

      const textarea = body?.querySelector<HTMLTextAreaElement>("textarea");
      expect(textarea).not.toBeNull();
      if (!textarea) throw new Error("expected abstract editor");
      textarea.value = "New abstract.\nWith a second line.";
      textarea.dispatchEvent(new Event("blur"));

      expect(view.state.doc.toString()).toContain(
        "abstract: |\n  New abstract.\n  With a second line.\n",
      );
      expect(view.state.doc.toString()).not.toContain("Old abstract");
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
