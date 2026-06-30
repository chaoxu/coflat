import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CSS } from "../../core/constants/css-classes";
import { equationLabelExtension } from "../../core/parser/equation-label";
import { mathExtension } from "../../core/parser/math-backslash";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { createTestView } from "../test-utils";
import { mathRenderPlugin } from "./math-render";
import { clearKatexCache } from "./math-widget";

function createMathRenderView(doc: string, cursorPos = 0): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      documentAnalysisField,
      mathRenderPlugin,
    ],
  });
}

describe("inline math mouse selection", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    vi.restoreAllMocks();
    clearKatexCache();
  });

  it("defers a selection that starts on rendered inline math until the drag direction is known", () => {
    const doc = "haha $x^2$, $y^2$";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    const sourceFrom = Number.parseInt(inline?.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline?.dataset.sourceTo ?? "", 10);

    vi.spyOn(currentView, "posAndSideAtCoords").mockImplementation((coords) => {
      if (coords.x > 10) {
        return { pos: sourceTo + 1, assoc: 1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
      }
      return { pos: sourceFrom - 2, assoc: -1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
    });

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: inline });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    const style = makeStyle(currentView, startEvent);
    if (!style) throw new Error("expected inline math mouse selection style");

    expect(style.get(startEvent, false, false).eq(currentView.state.selection)).toBe(true);

    const moveRight = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 30,
      clientY: 5,
    });
    const rightSelection = style.get(moveRight, false, false);
    expect(rightSelection.main.from).toBe(sourceFrom);
    expect(rightSelection.main.to).toBe(sourceTo + 1);
  });

  it("snaps a drag crossing rendered inline math to the full source span", () => {
    const doc = "haha $x^2$, $y^2$";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    const sourceFrom = Number.parseInt(inline?.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline?.dataset.sourceTo ?? "", 10);

    vi.spyOn(currentView, "posAndSideAtCoords").mockImplementation((coords) => {
      if (coords.x > 10) {
        return { pos: sourceFrom, assoc: 1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
      }
      return { pos: sourceFrom - 4, assoc: -1 } as ReturnType<EditorView["posAndSideAtCoords"]>;
    });

    const docView = currentView.dom.ownerDocument as Document & {
      elementFromPoint?: (x: number, y: number) => Element | null;
    };
    const originalElementFromPoint = docView.elementFromPoint;
    Object.defineProperty(docView, "elementFromPoint", {
      configurable: true,
      value: (x: number) => (x > 10 ? inline : currentView.contentDOM),
    });

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 0,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: currentView.contentDOM });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    const style = makeStyle(currentView, startEvent);
    if (!style) throw new Error("expected inline math mouse selection style");

    const moveIntoMath = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 20,
      clientY: 5,
    });
    Object.defineProperty(moveIntoMath, "target", { value: inline });

    try {
      const selection = style.get(moveIntoMath, false, false);
      expect(selection.main.from).toBe(sourceFrom - 4);
      expect(selection.main.to).toBe(sourceTo);
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(docView, "elementFromPoint", {
          configurable: true,
          value: originalElementFromPoint,
        });
      } else {
        Reflect.deleteProperty(docView, "elementFromPoint");
      }
    }
  });

  it("marks fully selected rendered inline math as a selected atom", () => {
    const doc = "before $x^2$ after";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    expect(inline).not.toBeNull();
    if (!inline) throw new Error("expected inline math");

    const sourceFrom = Number.parseInt(inline.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline.dataset.sourceTo ?? "", 10);
    currentView.dispatch({
      selection: EditorSelection.range(sourceFrom - 2, sourceTo + 2),
    });

    expect(inline.classList.contains("cf-selection-atom-selected")).toBe(true);
  });

  it("does not mark a formula atom for partial selection inside the same formula", () => {
    const doc = "before $x^2$ after";
    view = createMathRenderView(doc, 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const inline = currentView.contentDOM.querySelector<HTMLElement>(`.${CSS.mathInline}[aria-label="x^2"]`);
    expect(inline).not.toBeNull();
    if (!inline) throw new Error("expected inline math");

    const sourceFrom = Number.parseInt(inline.dataset.sourceFrom ?? "", 10);
    const sourceTo = Number.parseInt(inline.dataset.sourceTo ?? "", 10);
    currentView.dispatch({
      selection: EditorSelection.range(sourceFrom + 1, sourceTo - 1),
    });

    expect(inline.classList.contains("cf-selection-atom-selected")).toBe(false);
  });

  it("falls back to native mouse selection when no inline math is rendered", () => {
    view = createMathRenderView("plain text", 0);
    const currentView = view;
    if (!currentView) throw new Error("expected math render view");

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 5,
      clientY: 5,
      detail: 1,
    });
    Object.defineProperty(startEvent, "target", { value: currentView.contentDOM });

    const makeStyle = currentView.state.facet(EditorView.mouseSelectionStyle)[0];
    expect(makeStyle(currentView, startEvent)).toBeNull();
  });
});
