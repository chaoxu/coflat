import { EditorView, ViewPlugin } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type EditorDocumentChange,
  type MountedEditor,
  mountEditor,
} from "../../editor";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function mountWithCapturedView(options: {
  readonly doc: string;
  readonly onChange?: (doc: string) => void;
  readonly onDocumentChange?: (change: EditorDocumentChange) => void;
}): { readonly editor: MountedEditor; readonly view: () => EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  let capturedView: EditorView | null = null;
  const editor = mountEditor({
    parent,
    doc: options.doc,
    onChange: options.onChange,
    onDocumentChange: options.onDocumentChange,
    extensions: [
      ViewPlugin.define((view) => {
        capturedView = view;
        return {};
      }),
    ],
  });
  cleanups.push(() => {
    editor.unmount();
    parent.remove();
  });
  return {
    editor,
    view() {
      if (!capturedView) throw new Error("view was not captured");
      return capturedView;
    },
  };
}

describe("mountEditor document change callbacks", () => {
  it("emits CodeMirror change metadata without requiring onChange", () => {
    const changes: EditorDocumentChange[] = [];
    const onChange = vi.fn();
    const { view } = mountWithCapturedView({
      doc: "alpha",
      onChange,
      onDocumentChange(change) {
        changes.push(change);
      },
    });

    view().dispatch({ changes: { from: 5, insert: " beta" } });

    expect(changes).toHaveLength(1);
    expect(changes[0].changes.empty).toBe(false);
    expect(onChange).toHaveBeenCalledWith("alpha beta");
  });

  it("supports incremental document changes without an onChange handler", () => {
    const changes: EditorDocumentChange[] = [];
    const { editor, view } = mountWithCapturedView({
      doc: "alpha",
      onDocumentChange(change) {
        changes.push(change);
      },
    });

    view().dispatch({ changes: { from: 5, insert: " beta" } });

    expect(changes).toHaveLength(1);
    expect(changes[0].changes.empty).toBe(false);
    expect(editor.getDoc()).toBe("alpha beta");
  });

  it("does not emit document callbacks for programmatic setDoc", () => {
    const onChange = vi.fn();
    const onDocumentChange = vi.fn();
    const { editor } = mountWithCapturedView({
      doc: "alpha",
      onChange,
      onDocumentChange,
    });

    editor.setDoc("programmatic");

    expect(onChange).not.toHaveBeenCalled();
    expect(onDocumentChange).not.toHaveBeenCalled();
  });

  it("keeps delayed document snapshots tied to each change", () => {
    const changes: EditorDocumentChange[] = [];
    const { editor, view } = mountWithCapturedView({
      doc: "a",
      onDocumentChange(change) {
        changes.push(change);
      },
    });

    view().dispatch({ changes: { from: 1, insert: "b" } });
    view().dispatch({ changes: { from: 2, insert: "c" } });

    expect(changes).toHaveLength(2);
    expect(changes[0].changes.empty).toBe(false);
    expect(changes[1].changes.empty).toBe(false);
    expect(editor.getDoc()).toBe("abc");
  });

  it("replaces the live document when setDoc receives a different value", () => {
    const { editor, view } = mountWithCapturedView({
      doc: "alpha",
    });
    view().dispatch({ changes: { from: 5, insert: " beta" } });

    editor.setDoc("short");

    expect(editor.getDoc()).toBe("short");
  });

  it("inserts text at the current selection as a normal editor change", () => {
    const onChange = vi.fn();
    const changes: EditorDocumentChange[] = [];
    const { editor, view } = mountWithCapturedView({
      doc: "alpha omega",
      onChange,
      onDocumentChange(change) {
        changes.push(change);
      },
    });
    view().dispatch({ selection: { anchor: 5 } });

    editor.insertText(" beta");

    expect(editor.getDoc()).toBe("alpha beta omega");
    expect(onChange).toHaveBeenCalledWith("alpha beta omega");
    expect(changes).toHaveLength(1);
    expect(changes[0].changes.empty).toBe(false);
  });

  it("replaces the current selection when inserting text", () => {
    const { editor, view } = mountWithCapturedView({
      doc: "alpha TODO omega",
    });
    const from = "alpha ".length;
    const to = from + "TODO".length;
    view().dispatch({ selection: { anchor: from, head: to } });

    editor.insertText("done");

    expect(editor.getDoc()).toBe("alpha done omega");
  });

  it("inserts text at an explicit source position without replacing the current selection", () => {
    const { editor, view } = mountWithCapturedView({
      doc: "alpha TODO omega",
    });
    const from = "alpha ".length;
    const to = from + "TODO".length;
    view().dispatch({ selection: { anchor: from, head: to } });

    editor.insertText(" beta", { position: "alpha TODO".length });

    expect(editor.getDoc()).toBe("alpha TODO beta omega");
  });

});
