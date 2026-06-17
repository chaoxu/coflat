import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import {
  parseFrontmatter,
} from "../../core/parser";
import { buildDecorations } from "./decoration-core";
import { cursorSensitiveShouldRebuild } from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { RenderWidget } from "./source-widget";

const PARAGRAPH_FLOW_WIDGET_CLASS = "cf-paragraph-flow-widget";

function selectionIntersects(
  state: EditorState,
  from: number,
  to: number,
  focused: boolean,
): boolean {
  if (!focused) return false;
  return state.selection.ranges.some((range) => (
    range.empty
      ? from <= range.from && range.from <= to
      : range.from < to && from < range.to
  ));
}

function hasReferenceSyntax(text: string): boolean {
  return text.includes("[@") || /(^|[\s([{"'])@[A-Za-z0-9_:-]/.test(text);
}

function isTopLevelParagraph(node: SyntaxNode): boolean {
  return node.name === "Paragraph" && node.parent?.name === "Document";
}

function isMultiLineRange(state: EditorState, from: number, to: number): boolean {
  return state.doc.lineAt(from).number !== state.doc.lineAt(to).number;
}

function isEligibleParagraph(
  state: EditorState,
  node: SyntaxNode,
  focused: boolean,
): boolean {
  if (!isTopLevelParagraph(node)) return false;
  if (!isMultiLineRange(state, node.from, node.to)) return false;
  if (selectionIntersects(state, node.from, node.to, focused)) return false;

  const source = state.sliceDoc(node.from, node.to);
  if (hasReferenceSyntax(source)) return false;
  return true;
}

class ParagraphFlowWidget extends RenderWidget {
  useLiveSourceRange = false;

  constructor(
    private readonly source: string,
    private readonly fullDocumentSource: string,
  ) {
    super();
  }

  override toDOM(view?: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.flow,
      PARAGRAPH_FLOW_WIDGET_CLASS,
    );
    const config = parseFrontmatter(this.fullDocumentSource).config;
    renderPreviewBlockContentToDom(wrapper, this.source, { config });
    this.syncWidgetAttrs(wrapper, view);
    const paragraph = wrapper.querySelector<HTMLElement>(".cf-doc-paragraph");
    if (paragraph) {
      this.setSourceRangeAttrs(paragraph);
    }
    if (view) this.bindSourceReveal(wrapper, view);
    return wrapper;
  }

  override eq(other: ParagraphFlowWidget): boolean {
    return (
      this.source === other.source &&
      this.fullDocumentSource === other.fullDocumentSource
    );
  }
}

function collectParagraphFlowDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const fullDocumentSource = state.doc.toString();
  const items: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== "Paragraph") return undefined;
      const paragraph = node.node;
      if (!isEligibleParagraph(state, paragraph, focused)) return undefined;
      const widget = new ParagraphFlowWidget(
        state.sliceDoc(paragraph.from, paragraph.to),
        fullDocumentSource,
      );
      widget.updateSourceRange(paragraph.from, paragraph.to);
      items.push(
        Decoration.replace({
          widget,
          block: true,
          class: PARAGRAPH_FLOW_WIDGET_CLASS,
        }).range(paragraph.from, paragraph.to),
      );
      return false;
    },
  });
  return buildDecorations(items);
}

function shouldRebuildParagraphFlow(tr: Transaction): boolean {
  return (
    cursorSensitiveShouldRebuild(tr) ||
    (
      syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
      syntaxTreeAvailable(tr.state, tr.state.doc.length)
    )
  );
}

const paragraphFlowField = StateField.define<DecorationSet>({
  create: collectParagraphFlowDecorations,
  update(value, tr) {
    if (shouldRebuildParagraphFlow(tr)) {
      return collectParagraphFlowDecorations(tr.state);
    }
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});

export const paragraphFlowRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  paragraphFlowField,
];

export const _paragraphFlowFieldForTest = paragraphFlowField;
