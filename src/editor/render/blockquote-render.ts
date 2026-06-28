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
import { parseFrontmatter } from "../../core/parser";
import { buildDecorations } from "./decoration-core";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import { mathMacrosField } from "../state/math-macros";
import { RenderWidget } from "./source-widget";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";

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

class BlockquoteWidget extends RenderWidget {
  useLiveSourceRange = false;

  constructor(
    private readonly source: string,
    private readonly fullDocumentSource: string,
  ) {
    super();
  }

  override toDOM(view?: EditorView): HTMLElement {
    const host = document.createElement("div");
    const config = parseFrontmatter(this.fullDocumentSource).config;
    const options = view
      ? buildPreviewBlockOptions(
        view,
        view.state.field(mathMacrosField, false) ?? config.math ?? {},
      )
      : { config };
    renderPreviewBlockContentToDom(host, this.source, options);
    const blockquote = host.firstElementChild;
    if (!(blockquote instanceof HTMLElement)) {
      return host;
    }
    this.syncWidgetAttrs(blockquote, view);
    if (view) this.bindSourceReveal(blockquote, view);
    return blockquote;
  }

  override eq(other: BlockquoteWidget): boolean {
    return (
      other instanceof BlockquoteWidget &&
      this.source === other.source &&
      this.fullDocumentSource === other.fullDocumentSource
    );
  }
}

function collectBlockquoteDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const fullDocumentSource = state.doc.toString();
  const items: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== "Blockquote") return undefined;
      const blockquote: SyntaxNode = node.node;
      if (selectionIntersects(state, blockquote.from, blockquote.to, focused)) {
        return false;
      }
      const widget = new BlockquoteWidget(
        state.sliceDoc(blockquote.from, blockquote.to),
        fullDocumentSource,
      );
      widget.updateSourceRange(blockquote.from, blockquote.to);
      items.push(
        Decoration.replace({ widget, block: true }).range(blockquote.from, blockquote.to),
      );
      return false;
    },
  });
  return buildDecorations(items);
}

function shouldRebuildBlockquotes(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    !tr.startState.selection.eq(tr.state.selection) ||
    tr.startState.field(editorFocusField, false) !== tr.state.field(editorFocusField, false) ||
    (
      syntaxTree(tr.state) !== syntaxTree(tr.startState) &&
      syntaxTreeAvailable(tr.state, tr.state.doc.length)
    )
  );
}

const blockquoteField = StateField.define<DecorationSet>({
  create: collectBlockquoteDecorations,
  update(value, tr) {
    if (shouldRebuildBlockquotes(tr)) {
      return collectBlockquoteDecorations(tr.state);
    }
    return value;
  },
  provide(field) {
    return [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ];
  },
});

export const blockquoteRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  blockquoteField,
];

export const _blockquoteFieldForTest = blockquoteField;
