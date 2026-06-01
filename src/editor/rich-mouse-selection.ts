import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { DOCUMENT_SURFACE_CLASS } from "../core/document-surface-classes";
import { CSS } from "../core/constants/css-classes";
import {
  clampToLineBounds,
  coarseHitTestPositionAndSide,
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

function isTaskListLineTarget(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    return false;
  }
  const line = lineElementAtPoint(view, { x, y }, target);
  return Boolean(line?.classList.contains(DOCUMENT_SURFACE_CLASS.listItemCheck));
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
    ? target.closest<HTMLElement>(`.${CSS.mathInline}`)
    : null;
  if (direct) return true;
  const fromPoint = editorElementFromPoint(view, { x, y });
  return fromPoint instanceof HTMLElement
    ? Boolean(fromPoint.closest(`.${CSS.mathInline}`))
    : false;
}

function startsOnWidgetOwnedSurface(
  view: EditorView,
  x: number,
  y: number,
  target: EventTarget | null,
): boolean {
  const direct = target instanceof HTMLElement
    ? target.closest<HTMLElement>("[data-source-from]")
    : null;
  if (direct && !direct.classList.contains("cm-line")) return true;
  const fromPoint = editorElementFromPoint(view, { x, y });
  return fromPoint instanceof HTMLElement
    ? Boolean(fromPoint.closest("[data-source-from]:not(.cm-line)"))
    : false;
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

function createRichMouseSelectionStyle(
  view: EditorView,
  start: PointerSelectionTarget,
) {
  let startTarget = start;
  let lastResolvedTarget = start;

  return {
    get(currentEvent: MouseEvent) {
      const resolved = resolveVisibleLineTarget(
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

const richTaskListMouseDownGuard = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView) {
    if (!isRichLikeMode(view)) return false;
    if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return false;
    if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return false;
    if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return false;
    if (!isTaskListLineTarget(view, event.clientX, event.clientY, event.target)) return false;

    const target = resolveVisibleLineTarget(
      view,
      event.clientX,
      event.clientY,
      event.target,
    );
    if (!target) return false;

    event.preventDefault();
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(target.pos, target.assoc)]),
      scrollIntoView: false,
    });
    view.focus();
    return true;
  },
});

const richMouseSelectionStyleExtension = EditorView.mouseSelectionStyle.of((view, event) => {
  if (!isRichLikeMode(view)) return null;
  if (!isPlainPrimaryMouseEvent(event) || event.detail !== 1) return null;
  if (startsOnRenderedMath(view, event.clientX, event.clientY, event.target)) return null;
  if (startsOnWidgetOwnedSurface(view, event.clientX, event.clientY, event.target)) return null;

  const start = resolveVisibleLineTarget(
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
  richTaskListMouseDownGuard,
  richMouseSelectionStyleExtension,
];
