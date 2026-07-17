// Keep after-mount plugin dynamic imports from racing environment teardown.
import "../test-plugin-preload";
import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownExtensions } from "../../core/parser";
import { createEditor } from "../editor";
import { createTestView } from "../test-utils";
import { _blockquoteFieldForTest, blockquoteRenderPlugin } from "./blockquote-render";
import { focusEffect } from "./focus-state";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createBlockquoteView(doc: string, cursorPos: number): EditorView {
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      markdown({ extensions: markdownExtensions }),
      blockquoteRenderPlugin,
    ],
  });
  view.dispatch({ effects: focusEffect.of(true) });
  return view;
}

describe("blockquoteRenderPlugin", () => {
  it("renders a blockquote away from the caret as a widget", () => {
    const target = createBlockquoteView("> quoted text\n\nbody paragraph", 20);
    expect(target.dom.querySelector("blockquote")).not.toBeNull();
  });

  it("reuses the blockquote widget DOM across an unrelated edit", () => {
    const doc = "> quoted text\n\nbody paragraph";
    const target = createBlockquoteView(doc, doc.length);
    const before = target.dom.querySelector("blockquote");
    expect(before).not.toBeNull();

    // Edit the trailing paragraph, far from the blockquote. Its source slice
    // and the frontmatter config are unchanged, so the widget must compare
    // equal and CM6 must keep the existing DOM (no re-render).
    target.dispatch({
      changes: { from: doc.length, insert: " more" },
    });

    const after = target.dom.querySelector("blockquote");
    expect(after).toBe(before);
  });

  it("re-renders a blockquote crossref when a referenced number changes", () => {
    // The widget's toDOM resolves `[@eq:two]` to its number via the numbering
    // pipeline — a render input beyond the blockquote's own source. If eq()
    // ignored that, a renumber below the (fixed-range) blockquote would leave a
    // stale number. Baking the render-dependency signature into eq fixes it.
    const parent = document.createElement("div");
    const doc = "> See [@eq:two].\n\n$$a$$ {#eq:one}\n\n$$b$$ {#eq:two}\n";
    const editor = createEditor({ parent, doc });
    expect(editor.dom.querySelector("blockquote")?.textContent).toBe("See Eq. (2).");

    // Delete the eq:one line (an edit AFTER the blockquote, so its byte range is
    // unchanged); eq:two renumbers 2 → 1 and the blockquote must follow.
    const from = doc.indexOf("$$a$$ {#eq:one}\n\n");
    editor.dispatch({
      changes: { from, to: from + "$$a$$ {#eq:one}\n\n".length, insert: "" },
    });
    expect(editor.dom.querySelector("blockquote")?.textContent).toBe("See Eq. (1).");
    editor.destroy();
  });

  it("keeps the field value identical for caret moves outside the blockquote", () => {
    const doc = "> quoted text\n\nbody paragraph";
    const target = createBlockquoteView(doc, doc.length);
    const before = target.state.field(_blockquoteFieldForTest);

    target.dispatch({ selection: { anchor: doc.length - 3 } });

    expect(target.state.field(_blockquoteFieldForTest)).toBe(before);
  });

  it("reveals and re-renders the blockquote as the caret crosses it", () => {
    const doc = "> quoted text\n\nbody paragraph";
    const target = createBlockquoteView(doc, doc.length);
    expect(target.dom.querySelector("blockquote")).not.toBeNull();

    target.dispatch({ selection: { anchor: doc.indexOf("quoted") } });
    expect(target.dom.querySelector("blockquote")).toBeNull();

    target.dispatch({ selection: { anchor: doc.length } });
    expect(target.dom.querySelector("blockquote")).not.toBeNull();
  });

  it("reveals a blockquote touched by any range of a multi-range selection", () => {
    const doc = "> quoted text\n\nbody paragraph";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [
        markdown({ extensions: markdownExtensions }),
        EditorState.allowMultipleSelections.of(true),
        blockquoteRenderPlugin,
      ],
    });
    view.dispatch({ effects: focusEffect.of(true) });
    expect(view.dom.querySelector("blockquote")).not.toBeNull();

    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(doc.indexOf("quoted")),
        EditorSelection.cursor(doc.length),
      ], 1),
    });
    expect(view.dom.querySelector("blockquote")).toBeNull();
  });
});
