import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { type EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { footnoteExtension } from "../core/parser/footnote";
import {
  footnoteCommandsExtension,
  insertFootnote,
  jumpToFootnoteRef,
  selectFootnoteBeforeDelete,
} from "./footnote-commands";
import {
  FOOTNOTE_JUMP_BACK_CLASS,
  sidenoteRenderWithoutSectionPlugin,
  sidenotesCollapsedEffect,
} from "./render/sidenote-render";
import { activeStructureEditField } from "./state/cm-structure-edit";
import { frontmatterField } from "./state/frontmatter-state";
import { mathMacrosField } from "./state/math-macros";
import { createTestView, destroyAllTestViews } from "./test-utils";

function createView(doc: string, cursorPos?: number): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      history(),
      footnoteCommandsExtension,
    ],
  });
}

/** View with the sidenote render bundle mounted (for the label affordance). */
function createRenderedView(doc: string, cursorPos = 0): EditorView {
  return createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: [footnoteExtension] }),
      frontmatterField,
      mathMacrosField,
      activeStructureEditField,
      footnoteCommandsExtension,
      sidenoteRenderWithoutSectionPlugin,
    ],
  });
}

afterEach(() => {
  destroyAllTestViews();
});

describe("insertFootnote", () => {
  it("inserts a ref and definition into an empty document", () => {
    const view = createView("");

    expect(insertFootnote(view)).toBe(true);

    expect(view.state.doc.toString()).toBe("[^1]\n\n[^1]: ");
    // Cursor lands in the new definition body.
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(view.state.selection.main.empty).toBe(true);
  });

  it("inserts into a document with no definitions block", () => {
    const view = createView("Hello world", 5);

    expect(insertFootnote(view)).toBe(true);

    expect(view.state.doc.toString()).toBe("Hello[^1] world\n\n[^1]: ");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("appends after the last definition when the new number is highest", () => {
    const doc = "a[^1] b\n\n[^1]: first";
    const view = createView(doc, doc.indexOf(" b") + 2);

    expect(insertFootnote(view)).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "a[^1] b[^2]\n\n[^1]: first\n[^2]: ",
    );
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("inserts between existing footnotes, renumbering later refs and defs", () => {
    const doc = "a[^1] b c[^2]\n\n[^1]: first\n[^2]: second";
    const view = createView(doc, 7); // right after "b"

    expect(insertFootnote(view)).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "a[^1] b[^2] c[^3]\n\n[^1]: first\n[^2]: \n[^3]: second",
    );
    // Cursor at the end of the new "[^2]: " definition body.
    const defLineEnd = view.state.doc.toString().indexOf("[^2]: \n") + "[^2]: ".length;
    expect(view.state.selection.main.head).toBe(defLineEnd);
  });

  it("does not split an existing ref: inserts after it", () => {
    const doc = "a[^1] b\n\n[^1]: first";
    const view = createView(doc, 3); // inside [^1]

    expect(insertFootnote(view)).toBe(true);

    expect(view.state.doc.toString()).toBe(
      "a[^1][^2] b\n\n[^1]: first\n[^2]: ",
    );
  });

  it("undoes the insert and all renumbering as a single history step", () => {
    const doc = "a[^1] b c[^2]\n\n[^1]: first\n[^2]: second";
    const view = createView(doc, 7);

    expect(insertFootnote(view)).toBe(true);
    expect(view.state.doc.toString()).not.toBe(doc);

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("selectFootnoteBeforeDelete", () => {
  it("selects the whole ref when deleting into its end", () => {
    const view = createView("a[^1] b\n\n[^1]: x", 5); // right after [^1]

    expect(selectFootnoteBeforeDelete(view)).toBe(true);

    const main = view.state.selection.main;
    expect(main.from).toBe(1);
    expect(main.to).toBe(5);

    // With the ref selected, the guard steps aside so Backspace deletes it.
    expect(selectFootnoteBeforeDelete(view)).toBe(false);
    view.dispatch({ changes: { from: main.from, to: main.to } });
    expect(view.state.doc.toString()).toBe("a b\n\n[^1]: x");
  });

  it("does nothing away from a ref boundary", () => {
    const view = createView("a[^1] b\n\n[^1]: x", 6);

    expect(selectFootnoteBeforeDelete(view)).toBe(false);
    expect(view.state.selection.main.head).toBe(6);
  });
});

describe("jumpToFootnoteRef", () => {
  it("selects the ref when invoked from inside its definition", () => {
    const doc = "a[^1] b\n\n[^1]: x";
    const view = createView(doc, doc.length); // in the definition body

    expect(jumpToFootnoteRef(view)).toBe(true);

    const main = view.state.selection.main;
    expect(main.from).toBe(1);
    expect(main.to).toBe(5);
  });

  it("returns false outside a definition", () => {
    const view = createView("a[^1] b\n\n[^1]: x", 0);

    expect(jumpToFootnoteRef(view)).toBe(false);
  });
});

describe("definition jump-back affordance", () => {
  it("clicking the definition's jump-back button re-selects the ref", () => {
    const view = createRenderedView("a[^1] b\n\n[^1]: x", 0);
    // The definition chrome only renders in expanded (margin) mode.
    view.dispatch({ effects: sidenotesCollapsedEffect.of(false) });

    const button = view.dom.querySelector(`.${FOOTNOTE_JUMP_BACK_CLASS}`);
    expect(button).not.toBeNull();

    button?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    const main = view.state.selection.main;
    expect(main.from).toBe(1);
    expect(main.to).toBe(5);
  });
});
