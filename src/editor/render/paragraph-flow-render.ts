import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import type { FrontmatterConfig } from "../state/frontmatter-state";
import { frontmatterField } from "../state/frontmatter-state";
import { mathMacrosField } from "../state/math-macros";
import { buildDecorations } from "./decoration-core";
import {
  createDecorationStateField,
  cursorSensitiveShouldRebuild,
} from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  buildPreviewBlockOptions,
  getPreviewRenderDependencySignature,
} from "./hover-preview-block-options";
import { PARAGRAPH_FLOW_WIDGET_CLASS } from "./paragraph-flow-dom";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import {
  selectionIntersectsRange,
  shouldRenderBlockquoteAsFlow,
} from "./rendered-block-flow";
import { RenderWidget } from "./source-widget";

const BLOCKQUOTE_FLOW_WIDGET_CLASS = "cf-blockquote-flow-widget";
const PARAGRAPH_FLOW_SELECTION_FREEZE_TAIL_MS = 100;

const setParagraphFlowSelectionFrozen = StateEffect.define<boolean>();

const paragraphFlowSelectionFrozenField = StateField.define<boolean>({
  create: () => false,
  update(frozen, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setParagraphFlowSelectionFrozen)) return effect.value;
    }
    return frozen;
  },
});

function transactionChangesParagraphFlowSelectionFreeze(tr: Transaction): boolean {
  return tr.effects.some((effect) => effect.is(setParagraphFlowSelectionFrozen));
}

function isParagraphFlowPointerTarget(
  target: EventTarget | null,
  view: EditorView,
): boolean {
  if (!(target instanceof Node) || !view.contentDOM.contains(target)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return Boolean(element?.closest(`.${PARAGRAPH_FLOW_WIDGET_CLASS}`));
}

const paragraphFlowSelectionFreezePlugin = ViewPlugin.fromClass(class {
  private pointerDownInParagraphFlow = false;
  private releaseTimer: number | null = null;

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!isParagraphFlowPointerTarget(event.target, this.view)) return;
    this.pointerDownInParagraphFlow = true;
    if (this.releaseTimer !== null) {
      this.view.dom.ownerDocument.defaultView?.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (!this.view.state.field(paragraphFlowSelectionFrozenField)) {
      this.view.dispatch({ effects: setParagraphFlowSelectionFrozen.of(true) });
    }
  };

  private readonly onPointerRelease = () => {
    if (!this.pointerDownInParagraphFlow) return;
    this.pointerDownInParagraphFlow = false;
    if (this.releaseTimer !== null) {
      this.view.dom.ownerDocument.defaultView?.clearTimeout(this.releaseTimer);
    }
    this.releaseTimer = this.view.dom.ownerDocument.defaultView?.setTimeout(() => {
      this.releaseTimer = null;
      if (!this.view.state.field(paragraphFlowSelectionFrozenField)) return;
      try {
        this.view.dispatch({ effects: setParagraphFlowSelectionFrozen.of(false) });
      } catch {
        // The view may be destroyed while the release timer is pending.
      }
    }, PARAGRAPH_FLOW_SELECTION_FREEZE_TAIL_MS) ?? null;
  };

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener("pointerdown", this.onPointerDown, true);
    view.dom.ownerDocument.defaultView?.addEventListener("pointerup", this.onPointerRelease);
    view.dom.ownerDocument.defaultView?.addEventListener("pointercancel", this.onPointerRelease);
  }

  destroy() {
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown, true);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("pointerup", this.onPointerRelease);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("pointercancel", this.onPointerRelease);
    if (this.releaseTimer !== null) {
      this.view.dom.ownerDocument.defaultView?.clearTimeout(this.releaseTimer);
    }
  }
});

function selectionIntersects(
  state: EditorState,
  from: number,
  to: number,
  focused: boolean,
): boolean {
  return selectionIntersectsRange(state, from, to, focused);
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
  selectionFrozen: boolean,
): boolean {
  if (!isTopLevelParagraph(node)) return false;
  if (!isMultiLineRange(state, node.from, node.to)) return false;
  if (!selectionFrozen && selectionIntersects(state, node.from, node.to, focused)) return false;
  return true;
}

function isEligibleBlockquote(
  state: EditorState,
  node: SyntaxNode,
  focused: boolean,
): boolean {
  return shouldRenderBlockquoteAsFlow(state, node, focused);
}

class ParagraphFlowWidget extends RenderWidget {
  useLiveSourceRange = false;

  constructor(
    private readonly source: string,
    private readonly config: FrontmatterConfig,
    private readonly renderKey: string,
  ) {
    super();
  }

  override toDOM(view?: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.flow,
      PARAGRAPH_FLOW_WIDGET_CLASS,
    );
    const options = view
      ? buildPreviewBlockOptions(
        view,
        view.state.field(mathMacrosField, false) ?? this.config.math ?? {},
      )
      : { config: this.config };
    renderPreviewBlockContentToDom(wrapper, this.source, {
      ...options,
      paragraphSourceOffset: this.sourceFrom,
      paragraphSourcePositions: this.sourceFrom >= 0,
    });
    this.syncWidgetAttrs(wrapper, view);
    const paragraph = wrapper.querySelector<HTMLElement>(".cf-doc-paragraph");
    if (paragraph) {
      this.setSourceRangeAttrs(paragraph);
    }
    return wrapper;
  }

  override ignoreEvent(event?: Event): boolean {
    return event?.type !== "mousedown";
  }

  override eq(other: ParagraphFlowWidget): boolean {
    return (
      this.source === other.source &&
      this.renderKey === other.renderKey
    );
  }
}

class BlockquoteFlowWidget extends RenderWidget {
  useLiveSourceRange = false;

  constructor(
    private readonly source: string,
    private readonly config: FrontmatterConfig,
    private readonly renderKey: string,
  ) {
    super();
  }

  override toDOM(view?: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = documentSurfaceClassNames(
      DOCUMENT_SURFACE_CLASS.flow,
      PARAGRAPH_FLOW_WIDGET_CLASS,
      BLOCKQUOTE_FLOW_WIDGET_CLASS,
    );
    const options = view
      ? buildPreviewBlockOptions(
        view,
        view.state.field(mathMacrosField, false) ?? this.config.math ?? {},
      )
      : { config: this.config };
    renderPreviewBlockContentToDom(wrapper, this.source, {
      ...options,
      paragraphSourceOffset: this.sourceFrom,
      paragraphSourcePositions: this.sourceFrom >= 0,
    });
    this.syncWidgetAttrs(wrapper, view);
    const blockquote = wrapper.querySelector<HTMLElement>(".cf-doc-blockquote");
    if (blockquote) {
      this.setSourceRangeAttrs(blockquote);
    }
    if (view) this.bindSourceReveal(wrapper, view);
    return wrapper;
  }

  override ignoreEvent(event?: Event): boolean {
    return event?.type !== "mousedown";
  }

  override eq(other: BlockquoteFlowWidget): boolean {
    return (
      this.source === other.source &&
      this.renderKey === other.renderKey
    );
  }
}

function paragraphFlowConfig(state: EditorState): FrontmatterConfig {
  return state.field(frontmatterField, false)?.config ?? {};
}

function collectParagraphFlowItems(
  state: EditorState,
): Range<Decoration>[] {
  const focused = state.field(editorFocusField, false) ?? false;
  const selectionFrozen = state.field(paragraphFlowSelectionFrozenField, false) ?? false;
  const config = paragraphFlowConfig(state);
  const renderKey = getPreviewRenderDependencySignature(state);
  const items: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name === "Paragraph") {
        const paragraph = node.node;
        if (!isEligibleParagraph(state, paragraph, focused, selectionFrozen)) return undefined;
        const widget = new ParagraphFlowWidget(
          state.sliceDoc(paragraph.from, paragraph.to),
          config,
          renderKey,
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
      }
      if (node.name === "Blockquote") {
        const blockquote = node.node;
        if (!isEligibleBlockquote(state, blockquote, focused)) return undefined;
        const widget = new BlockquoteFlowWidget(
          state.sliceDoc(blockquote.from, blockquote.to),
          config,
          renderKey,
        );
        widget.updateSourceRange(blockquote.from, blockquote.to);
        items.push(
          Decoration.replace({
            widget,
            block: true,
            class: `${PARAGRAPH_FLOW_WIDGET_CLASS} ${BLOCKQUOTE_FLOW_WIDGET_CLASS}`,
          }).range(blockquote.from, blockquote.to),
        );
        return false;
      }
      return undefined;
    },
  });
  return items;
}

function collectParagraphFlowDecorations(state: EditorState): DecorationSet {
  return buildDecorations(collectParagraphFlowItems(state));
}

function paragraphFlowDependenciesNeedRebuild(tr: Transaction): boolean {
  return getPreviewRenderDependencySignature(tr.startState) !==
    getPreviewRenderDependencySignature(tr.state);
}

const paragraphFlowField = createDecorationStateField({
  atomicRanges: true,
  create: collectParagraphFlowDecorations,
  update(value, tr) {
    if (
      transactionChangesParagraphFlowSelectionFreeze(tr) ||
      cursorSensitiveShouldRebuild(tr) ||
      paragraphFlowDependenciesNeedRebuild(tr)
    ) {
      return collectParagraphFlowDecorations(tr.state);
    }
    return value;
  },
});

export const paragraphFlowRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  paragraphFlowSelectionFrozenField,
  paragraphFlowSelectionFreezePlugin,
  paragraphFlowField,
];

export const _paragraphFlowFieldForTest = paragraphFlowField;
