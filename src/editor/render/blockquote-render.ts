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
import type { FrontmatterConfig } from "../state/frontmatter-state";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { buildDecorations } from "./decoration-core";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  buildPreviewBlockOptions,
  getPreviewRenderDependencySignature,
} from "./hover-preview-block-options";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { RenderWidget } from "./source-widget";

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
    private readonly config: FrontmatterConfig,
    private readonly renderKey: string,
  ) {
    super();
  }

  override toDOM(view?: EditorView): HTMLElement {
    const host = document.createElement("div");
    const config = this.config;
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
    // `renderKey` is getPreviewRenderDependencySignature: it captures every
    // render input this widget's toDOM consumes beyond its own source —
    // numbering/crossrefs, bibliography, macros and the config identity. Baking
    // it in (rather than the whole document source) lets an unrelated keystroke
    // reuse this blockquote's DOM, while a change to any referenced number,
    // citation or macro still forces a re-render. Mirrors ParagraphFlowWidget.
    return (
      other instanceof BlockquoteWidget &&
      this.source === other.source &&
      this.renderKey === other.renderKey
    );
  }
}

function collectBlockquoteDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const config = state.field(frontmatterField, false)?.config ?? {};
  const renderKey = getPreviewRenderDependencySignature(state);
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
        config,
        renderKey,
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
    // Numbering/bibliography/macro updates can change the render signature
    // without a doc change (e.g. async bib data); rebuild so eq is re-consulted.
    getPreviewRenderDependencySignature(tr.startState) !==
      getPreviewRenderDependencySignature(tr.state) ||
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
  frontmatterField,
  blockquoteField,
];

export const _blockquoteFieldForTest = blockquoteField;
