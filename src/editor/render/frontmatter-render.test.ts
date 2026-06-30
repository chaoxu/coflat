import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { type Decoration, EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import {
  activeStructureEditField,
  createStructureEditTargetAt,
  setStructureEditTargetEffect,
} from "../state/cm-structure-edit";
import { frontmatterField } from "../state/frontmatter-state";
import { applyStateEffects } from "../test-utils";
import { frontmatterDecoration, frontmatterDecorationField } from "./frontmatter-render";

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      frontmatterField,
      activeStructureEditField,
      frontmatterDecoration,
    ],
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

function frontmatterDecorationClasses(state: EditorState): Array<{ pos: number; className: string; tagName: string | undefined }> {
  const result: Array<{ pos: number; className: string; tagName: string | undefined }> = [];
  const iter = state.field(frontmatterDecorationField).iter();
  while (iter.value) {
    const spec = iter.value as Decoration & {
      spec?: {
        class?: string;
        attributes?: Record<string, string>;
      };
    };
    if (spec.spec?.class) {
      result.push({
        pos: iter.from,
        className: spec.spec.class,
        tagName: spec.spec.attributes?.["data-tag-name"],
      });
    }
    iter.next();
  }
  return result;
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
    expect(iter.to).toBe(doc.indexOf("Content") - 1);
  });

  it("keeps the first visible paragraph after frontmatter selectable", () => {
    const doc = [
      "---",
      "id: ztrcpji2",
      "---",
      "",
      "motivated by a workshop",
      "",
      "second paragraph",
    ].join("\n");
    const state = createState(doc);
    const firstParagraphStart = doc.indexOf("motivated");

    expect(frontmatterDecorationClasses(state)).toContainEqual({
      pos: firstParagraphStart,
      className: "cf-doc-paragraph",
      tagName: "p",
    });
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

  it("ignores frontmatter abstract in the article header widget", () => {
    const state = createState("---\ntitle: Hello\nabstract: |\n  Short $x^2$ abstract.\nabstract-title: Summary\n---\nContent");
    const widget = getArticleHeaderWidget(state);
    const dom = widget.toDOM();

    expect(dom.querySelector(".cf-doc-title")?.textContent).toContain("Hello");
    expect(dom.querySelector(".cf-doc-abstract")).toBeNull();
    expect(dom.textContent).not.toContain("Short");
    expect(dom.textContent).not.toContain("Summary");
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
