import { describe, expect, it, afterEach } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { type EditorView, runScopeHandlers } from "@codemirror/view";

import {
  listOutlinerExtension,
  outdentListItem,
} from "./list-outliner";
import { createTestView } from "./test-utils";

function runEditorKey(view: EditorView, key: string, init?: KeyboardEventInit): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...init }), "editor");
}

describe("native markdown list writing", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("continues a bullet item on Enter through CodeMirror's Markdown command", () => {
    const doc = "- current";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), listOutlinerExtension],
    });

    expect(runEditorKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- current\n- ");
  });

  it("exits an empty list item on the second Enter from a normal item", () => {
    const doc = "- one";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), listOutlinerExtension],
    });

    expect(runEditorKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n- ");
    expect(runEditorKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n\n");
    expect(view.state.selection.main.head).toBe("- one\n\n".length);
  });

  it("removes a list marker on Backspace before item text", () => {
    const doc = "- one\n- two";
    view = createTestView(doc, {
      cursorPos: "- one\n- ".length,
      extensions: [markdown(), listOutlinerExtension],
    });

    expect(runEditorKey(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\ntwo");
    expect(view.state.selection.main.head).toBe("- one\n".length);
  });

  it("exits an existing empty list item without requiring an extra blank marker", () => {
    const doc = "- one\n- ";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown(), listOutlinerExtension],
    });

    expect(runEditorKey(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- one\n\n");
    expect(view.state.selection.main.head).toBe("- one\n\n".length);
  });
});

describe("outdentListItem", () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  it("demotes a top-level item to plain paragraph text", () => {
    const doc = "- item";
    view = createTestView(doc, {
      cursorPos: doc.length,
      extensions: [markdown()],
    });

    expect(outdentListItem(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("item");
    expect(view.state.selection.main.head).toBe("item".length);
  });
});
