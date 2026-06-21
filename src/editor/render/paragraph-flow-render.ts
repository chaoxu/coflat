import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
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
import {
  parseFrontmatter,
} from "../../core/parser";
import { mathMacrosField } from "../state/math-macros";
import { buildDecorations } from "./decoration-core";
import { cursorSensitiveShouldRebuild } from "./decoration-field";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import { PARAGRAPH_FLOW_WIDGET_CLASS } from "./paragraph-flow-dom";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { getReferenceRenderDependencySignature } from "./reference-render";
import { RenderWidget } from "./source-widget";

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
  if (!focused) return false;
  return state.selection.ranges.some((range) => (
    range.empty
      ? from <= range.from && range.from <= to
      : range.from < to && from < range.to
  ));
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
    const options = view
      ? buildPreviewBlockOptions(
        view,
        view.state.field(mathMacrosField, false) ?? config.math ?? {},
      )
      : { config };
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
      this.fullDocumentSource === other.fullDocumentSource
    );
  }
}

function collectParagraphFlowDecorations(state: EditorState): DecorationSet {
  const focused = state.field(editorFocusField, false) ?? false;
  const selectionFrozen = state.field(paragraphFlowSelectionFrozenField, false) ?? false;
  const fullDocumentSource = state.doc.toString();
  const items: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (node.name !== "Paragraph") return undefined;
      const paragraph = node.node;
      if (!isEligibleParagraph(state, paragraph, focused, selectionFrozen)) return undefined;
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
    transactionChangesParagraphFlowSelectionFreeze(tr) ||
    cursorSensitiveShouldRebuild(tr) ||
    getReferenceRenderDependencySignature(tr.startState) !== getReferenceRenderDependencySignature(tr.state) ||
    tr.startState.field(mathMacrosField, false) !== tr.state.field(mathMacrosField, false) ||
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
  paragraphFlowSelectionFrozenField,
  paragraphFlowSelectionFreezePlugin,
  paragraphFlowField,
];

export const _paragraphFlowFieldForTest = paragraphFlowField;
