import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { DOCUMENT_SURFACE_CLASS } from "../core/document-surface-classes";
import { CSS } from "../core/constants/css-classes";
import {
  clampToLineBounds,
  coarseHitTestPositionAndSide,
  domCaretRangeAtPoint,
  domCaretHitTestPosition,
  editorElementFromPoint,
  editorElementsFromPoint,
  lineBoundsForElement,
  lineElementAtPoint,
  type EditorLineBounds,
} from "./lib/editor-hit-test";
import {
  buildPointerSelection,
  isPlainPrimaryMouseEvent,
  type PointerSelectionTarget,
} from "./state/mouse-selection";
import {
  closestMathSourceCarrier,
  closestSourceRangeCarrier,
  isAtomicSourceRangeCarrier,
  mapDomRangeToSource,
  sourceRangeFromElement,
} from "../core/source-range-surface";
import { PARAGRAPH_FLOW_WIDGET_CLASS } from "./render/paragraph-flow-dom";

function isRichLikeMode(view: EditorView): boolean {
  return !view.dom.classList.contains(CSS.sourceMode);
}

function domCaretTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
  line: HTMLElement,
  bounds: EditorLineBounds,
): PointerSelectionTarget | null {
  const hit = domCaretHitTestPosition(view, { x, y }, { within: line, bounds });
  if (!hit) return null;
  return {
    pos: hit.pos,
    assoc: hit.pos <= bounds.from ? 1 : hit.pos >= bounds.to ? -1 : 1,
  };
}

function coordTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
  bounds: EditorLineBounds,
): PointerSelectionTarget | null {
  const resolved = coarseHitTestPositionAndSide(view, { x, y }, bounds);
  if (!resolved) return null;
  return {
    pos: clampToLineBounds(bounds, resolved.pos),
    assoc: resolved.assoc,
  };
}

function fallbackTargetForLine(
  line: HTMLElement,
  bounds: EditorLineBounds,
  x: number,
): PointerSelectionTarget {
  const text = (line.textContent ?? "").trim();
  if (text.length === 0) {
    return { pos: bounds.from, assoc: 1 };
  }

  const rect = line.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;
  return x >= midpoint
    ? { pos: bounds.to, assoc: -1 }
    : { pos: bounds.from, assoc: 1 };
}

function resolveVisibleLineTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): PointerSelectionTarget | null {
  const line = lineElementAtPoint(view, { x, y }, target);
  if (!line) return null;
  const bounds = lineBoundsForElement(view, line);
  if (!bounds) return null;
  return (
    domCaretTargetAtPoint(view, x, y, line, bounds)
    ?? coordTargetAtPoint(view, x, y, bounds)
    ?? fallbackTargetForLine(line, bounds, x)
  );
}

function isParagraphFlowSourceCarrier(carrier: Element | null): carrier is HTMLElement {
  return carrier instanceof HTMLElement && Boolean(carrier.closest(`.${PARAGRAPH_FLOW_WIDGET_CLASS}`));
}

function paragraphFlowSourceCarrierFromElement(element: Element | null): HTMLElement | null {
  const carrier = closestSourceRangeCarrier(element, { ignoredClassNames: ["cm-line"] });
  return isParagraphFlowSourceCarrier(carrier) ? carrier : null;
}

function paragraphFlowSourceCarrierAtPoint(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): HTMLElement | null {
  const direct = target instanceof Element
    ? paragraphFlowSourceCarrierFromElement(target)
    : null;
  if (direct) return direct;

  const fromPoint = editorElementFromPoint(view, { x, y });
  return fromPoint instanceof Element
    ? paragraphFlowSourceCarrierFromElement(fromPoint)
    : null;
}

function fallbackSourceRangeTargetAtPoint(
  carrier: HTMLElement,
  x: number,
): PointerSelectionTarget | null {
  const sourceRange = sourceRangeFromElement(carrier);
  if (!sourceRange) return null;
  const rect = carrier.getBoundingClientRect();
  if (rect.width <= 0 || sourceRange.to <= sourceRange.from) {
    return { pos: sourceRange.from, assoc: 1 };
  }
  const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  const pos = Math.round(sourceRange.from + ratio * (sourceRange.to - sourceRange.from));
  return {
    pos: Math.max(sourceRange.from, Math.min(sourceRange.to, pos)),
    assoc: ratio >= 0.5 ? -1 : 1,
  };
}

function atomicSourceRangeTargetAtPoint(
  carrier: HTMLElement,
  x: number,
): PointerSelectionTarget | null {
  const sourceRange = sourceRangeFromElement(carrier);
  if (!sourceRange) return null;
  const rect = carrier.getBoundingClientRect();
  if (rect.width <= 0) return { pos: sourceRange.from, assoc: 1 };
  const midpoint = rect.left + rect.width / 2;
  return x >= midpoint
    ? { pos: sourceRange.to, assoc: -1 }
    : { pos: sourceRange.from, assoc: 1 };
}

function sourceRangeTargetAtPoint(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): PointerSelectionTarget | null {
  const carrier = paragraphFlowSourceCarrierAtPoint(view, x, y, target);
  if (!carrier) return null;
  if (isAtomicSourceRangeCarrier(carrier)) {
    return atomicSourceRangeTargetAtPoint(carrier, x);
  }

  const range = domCaretRangeAtPoint(view.dom.ownerDocument, { x, y });
  if (range) {
    const sourceRange = mapDomRangeToSource(range, view.contentDOM);
    if (sourceRange) {
      return { pos: sourceRange.from, assoc: 1 };
    }
  }

  return fallbackSourceRangeTargetAtPoint(carrier, x);
}

function resolveRichSelectionTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): PointerSelectionTarget | null {
  return (
    sourceRangeTargetAtPoint(view, x, y, target) ??
    resolveVisibleLineTarget(view, x, y, target)
  );
}

function isCheckboxTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === "checkbox";
}

function isPlainRenderedLineTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  if (isCheckboxTarget(target)) return false;
  const line = lineElementAtPoint(view, { x, y }, target);
  return Boolean(line);
}

function isImmediatePointGuardLineTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const line = lineElementAtPoint(view, { x, y }, target);
  if (isCheckboxTarget(target) || !line) return false;
  return (
    line.classList.contains(DOCUMENT_SURFACE_CLASS.listItemCheck) ||
    line.classList.contains(CSS.codeblockHeader) ||
    line.classList.contains(CSS.codeblockBody) ||
    line.classList.contains(CSS.codeblockLast)
  );
}

function isContentSurfaceTarget(
  view: EditorView,
  target: EventTarget | null,
): boolean {
  return target instanceof HTMLElement
    && (
      target === view.contentDOM ||
      target.classList.contains("cm-content") ||
      view.contentDOM.contains(target)
    );
}

function hasVisibleLineUnderPoint(
  view: EditorView,
  x: number,
  y: number,
): boolean {
  return editorElementsFromPoint(view, { x, y })
    .some((element) => element instanceof HTMLElement && view.contentDOM.contains(element) && element.classList.contains("cm-line"));
}

function startsOnRenderedMath(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const direct = target instanceof HTMLElement
    ? closestMathSourceCarrier(target)
    : null;
  if (direct) return true;
  const fromPoint = editorElementFromPoint(view, { x, y });
  return fromPoint instanceof HTMLElement
    ? Boolean(closestMathSourceCarrier(fromPoint))
    : false;
}

function startsOnWidgetOwnedSurface(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const direct = target instanceof HTMLElement
    ? closestSourceRangeCarrier(target, { ignoredClassNames: ["cm-line"] })
    : null;
  if (direct && !isParagraphFlowSourceCarrier(direct)) return true;
  const fromPoint = editorElementFromPoint(view, { x, y });
  if (!(fromPoint instanceof HTMLElement)) return false;
  const carrier = closestSourceRangeCarrier(fromPoint, { ignoredClassNames: ["cm-line"] });
  return Boolean(carrier && !isParagraphFlowSourceCarrier(carrier));
}

function mapTarget(
  target: PointerSelectionTarget,
  update: ViewUpdate,
): PointerSelectionTarget {
  return {
    pos: update.changes.mapPos(target.pos, target.assoc),
    assoc: target.assoc,
  };
}

function createStickySelectionStyle(
  selection: EditorSelection,
) {
  return {
    get() {
      return selection;
    },
    update() {
      return false;
    },
  };
}

interface ActiveParagraphFlowPointerSelection {
  readonly pointerId: number;
  readonly start: PointerSelectionTarget;
  current: PointerSelectionTarget;
}

const paragraphFlowPointerSelectionPlugin = ViewPlugin.fromClass(class {
  private active: ActiveParagraphFlowPointerSelection | null = null;

  private readonly onPointerDown = (event: PointerEvent) => {
    const view = this.view;
    if (!isRichLikeMode(view)) return;
    if (!isPlainPrimaryMouseEvent(event) || !event.isPrimary) return;
    if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return;

    const start = sourceRangeTargetAtPoint(
      view,
      event.clientX,
      event.clientY,
      event.target,
    );
    if (!start) return;

    event.preventDefault();
    view.focus();
    this.active = {
      pointerId: event.pointerId,
      start,
      current: start,
    };
    view.dom.ownerDocument.defaultView?.addEventListener("pointermove", this.onPointerMove, true);
    view.dom.ownerDocument.defaultView?.addEventListener("pointerup", this.onPointerUp, true);
    view.dom.ownerDocument.defaultView?.addEventListener("pointercancel", this.onPointerCancel, true);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = resolveRichSelectionTarget(
      this.view,
      event.clientX,
      event.clientY,
      event.target,
    ) ?? active.current;
    active.current = current;
    this.view.dispatch({
      selection: buildPointerSelection(active.start, current),
      scrollIntoView: false,
    });
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const active = this.active;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = resolveRichSelectionTarget(
      this.view,
      event.clientX,
      event.clientY,
      event.target,
    ) ?? active.current;
    this.view.dispatch({
      selection: buildPointerSelection(active.start, current),
      scrollIntoView: false,
    });
    this.clearActive();
  };

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (!this.active || this.active.pointerId !== event.pointerId) return;
    this.clearActive();
  };

  private clearActive(): void {
    if (!this.active) return;
    this.active = null;
    this.view.dom.ownerDocument.defaultView?.removeEventListener("pointermove", this.onPointerMove, true);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("pointerup", this.onPointerUp, true);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("pointercancel", this.onPointerCancel, true);
  }

  constructor(private readonly view: EditorView) {
    view.dom.addEventListener("pointerdown", this.onPointerDown, true);
  }

  destroy() {
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown, true);
    this.clearActive();
  }
});

function createRichMouseSelectionStyle(
  view: EditorView,
  start: PointerSelectionTarget,
) {
  let startTarget = start;
  let lastResolvedTarget = start;

  return {
    get(currentEvent: MouseEvent) {
      const resolved = resolveRichSelectionTarget(
        view,
        currentEvent.clientX,
        currentEvent.clientY,
        currentEvent.target,
      ) ?? lastResolvedTarget;
      lastResolvedTarget = resolved;
      return buildPointerSelection(startTarget, resolved);
    },

    update(update: ViewUpdate) {
      if (!update.docChanged) return false;
      startTarget = mapTarget(startTarget, update);
      lastResolvedTarget = mapTarget(lastResolvedTarget, update);
      return false;
    },
  };
}

function dispatchPointSelection(
  view: EditorView,
  target: PointerSelectionTarget,
): void {
  if (!view.dom.isConnected) return;
  view.dispatch({
    selection: EditorSelection.create([EditorSelection.cursor(target.pos, target.assoc)]),
    scrollIntoView: false,
  });
  view.focus();
}

function dispatchPointSelectionAfterDefault(
  view: EditorView,
  target: PointerSelectionTarget,
): void {
  window.setTimeout(() => dispatchPointSelection(view, target), 0);
  window.setTimeout(() => dispatchPointSelection(view, target), 25);
}

const richPointClickGuardPlugin = ViewPlugin.fromClass(class {
  private pendingTarget: PointerSelectionTarget | null = null;
  private pendingTargetUntil = 0;

  private rememberTarget(target: PointerSelectionTarget): void {
    this.pendingTarget = target;
    this.pendingTargetUntil = Date.now() + 750;
  }

  private readonly onKeyDown = () => {
    if (!this.pendingTarget || Date.now() > this.pendingTargetUntil) {
      this.pendingTarget = null;
      return;
    }
    dispatchPointSelection(this.view, this.pendingTarget);
    this.pendingTarget = null;
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    const view = this.view;
    if (!view.dom.contains(event.target as Node | null)) return false;
    if (!isRichLikeMode(view)) return false;
    if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return false;
    if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return false;
    if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return false;
    if (!isImmediatePointGuardLineTarget(view, event.clientX, event.clientY, event.target)) return false;

    const target = resolveRichSelectionTarget(
      view,
      event.clientX,
      event.clientY,
      event.target,
    );
    if (!target) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.rememberTarget(target);
    dispatchPointSelection(view, target);
    dispatchPointSelectionAfterDefault(view, target);
    return true;
  };

  private readonly onClick = (event: MouseEvent) => {
    const view = this.view;
    if (this.pendingTarget && Date.now() <= this.pendingTargetUntil) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      dispatchPointSelection(view, this.pendingTarget);
      dispatchPointSelectionAfterDefault(view, this.pendingTarget);
      return true;
    }
    if (!view.dom.contains(event.target as Node | null)) return false;
    if (!isRichLikeMode(view)) return false;
    if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return false;
    if (!view.state.selection.main.empty) return false;
    if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return false;
    if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return false;
    if (!isPlainRenderedLineTarget(view, event.clientX, event.clientY, event.target)) return false;

    const target = resolveRichSelectionTarget(
      view,
      event.clientX,
      event.clientY,
      event.target,
    );
    if (!target) return false;

    event.stopPropagation();
    event.stopImmediatePropagation();
    dispatchPointSelection(view, target);
    return true;
  };

  constructor(private readonly view: EditorView) {
    view.dom.ownerDocument.addEventListener("mousedown", this.onMouseDown, true);
    view.dom.ownerDocument.addEventListener("click", this.onClick, true);
    view.dom.ownerDocument.defaultView?.addEventListener("keydown", this.onKeyDown, true);
    view.dom.ownerDocument.defaultView?.addEventListener("beforeinput", this.onKeyDown, true);
  }

  destroy() {
    this.view.dom.ownerDocument.removeEventListener("mousedown", this.onMouseDown, true);
    this.view.dom.ownerDocument.removeEventListener("click", this.onClick, true);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("keydown", this.onKeyDown, true);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("beforeinput", this.onKeyDown, true);
  }
});

const richMouseSelectionStyleExtension = EditorView.mouseSelectionStyle.of((view, event) => {
  if (!isRichLikeMode(view)) return null;
  if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return null;
  if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return null;
  if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return null;

  const start = resolveRichSelectionTarget(
    view,
    event.clientX,
    event.clientY,
    event.target,
  );
  if (start) {
    return createRichMouseSelectionStyle(view, start);
  }

  if (
    isContentSurfaceTarget(view, event.target) &&
    !hasVisibleLineUnderPoint(view, event.clientX, event.clientY)
  ) {
    return createStickySelectionStyle(view.state.selection);
  }

  return null;
});

export const richMouseSelectionStyle: Extension = [
  Prec.highest(paragraphFlowPointerSelectionPlugin),
  Prec.highest(richPointClickGuardPlugin),
  richMouseSelectionStyleExtension,
];
