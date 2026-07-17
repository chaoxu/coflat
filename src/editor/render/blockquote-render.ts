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
import type { SyntaxNode, SyntaxNodeRef, Tree } from "@lezer/common";
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
import { applyFlowSelectionPatch } from "./rendered-block-flow";
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

interface BlockquoteCandidate {
  readonly from: number;
  readonly to: number;
}

interface BlockquoteFieldValue {
  readonly decorations: DecorationSet;
  // Every outermost Blockquote range, rendered or not. A revealed blockquote
  // has no decoration to test against, so selection diffing needs this list.
  readonly candidates: readonly BlockquoteCandidate[];
  // Tree the candidates were collected from; selection-only patches bail to a
  // full rebuild when a background parse advanced the tree in between.
  readonly tree: Tree;
}

function blockquoteItem(
  state: EditorState,
  from: number,
  to: number,
  config: FrontmatterConfig,
  renderKey: string,
): Range<Decoration> {
  const widget = new BlockquoteWidget(state.sliceDoc(from, to), config, renderKey);
  widget.updateSourceRange(from, to);
  return Decoration.replace({ widget, block: true }).range(from, to);
}

function buildBlockquoteValue(state: EditorState): BlockquoteFieldValue {
  const focused = state.field(editorFocusField, false) ?? false;
  const config = state.field(frontmatterField, false)?.config ?? {};
  const renderKey = getPreviewRenderDependencySignature(state);
  const items: Range<Decoration>[] = [];
  const candidates: BlockquoteCandidate[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== "Blockquote") return undefined;
      const blockquote: SyntaxNode = node.node;
      candidates.push({ from: blockquote.from, to: blockquote.to });
      if (!selectionIntersects(state, blockquote.from, blockquote.to, focused)) {
        items.push(blockquoteItem(state, blockquote.from, blockquote.to, config, renderKey));
      }
      return false;
    },
  });
  return { decorations: buildDecorations(items), candidates, tree };
}

function collectBlockquoteItemsInRanges(
  state: EditorState,
  ranges: readonly BlockquoteCandidate[],
): Range<Decoration>[] {
  const focused = state.field(editorFocusField, false) ?? false;
  const config = state.field(frontmatterField, false)?.config ?? {};
  const renderKey = getPreviewRenderDependencySignature(state);
  const items: Range<Decoration>[] = [];
  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node: SyntaxNodeRef) {
        if (node.name !== "Blockquote") return undefined;
        // Scoped iteration also enters blockquotes that merely touch the
        // window; only the exact candidate may re-emit a widget — its
        // neighbours' decorations are still in the set.
        if (node.from !== range.from || node.to !== range.to) return false;
        if (!selectionIntersects(state, node.from, node.to, focused)) {
          items.push(blockquoteItem(state, node.from, node.to, config, renderKey));
        }
        return false;
      },
    });
  }
  return items;
}

// Selection-only path; the diff/patch machinery is applyFlowSelectionPatch.
function applyBlockquoteSelectionUpdate(
  value: BlockquoteFieldValue,
  tr: Transaction,
): BlockquoteFieldValue {
  const focused = tr.state.field(editorFocusField, false) ?? false;
  const decorations = applyFlowSelectionPatch(
    value,
    tr,
    (state, candidate) => selectionIntersects(state, candidate.from, candidate.to, focused),
    collectBlockquoteItemsInRanges,
  );
  if (decorations === null) return buildBlockquoteValue(tr.state);
  return decorations === value.decorations ? value : { ...value, decorations };
}

function shouldRebuildBlockquotes(tr: Transaction): boolean {
  return (
    tr.docChanged ||
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

const blockquoteField = StateField.define<BlockquoteFieldValue>({
  create: buildBlockquoteValue,
  update(value, tr) {
    if (shouldRebuildBlockquotes(tr)) {
      return buildBlockquoteValue(tr.state);
    }
    if (!tr.startState.selection.eq(tr.state.selection)) {
      return applyBlockquoteSelectionUpdate(value, tr);
    }
    return value;
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
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
