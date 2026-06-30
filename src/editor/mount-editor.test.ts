import { EditorView, ViewPlugin } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type MountedDocumentChange,
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
  readonly onDocumentChange?: (change: MountedDocumentChange) => void;
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
    const changes: MountedDocumentChange[] = [];
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
    expect(changes[0].getDoc()).toBe("alpha beta");
    expect(onChange).toHaveBeenCalledWith("alpha beta");
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
    const changes: MountedDocumentChange[] = [];
    const { editor, view } = mountWithCapturedView({
      doc: "a",
      onDocumentChange(change) {
        changes.push(change);
      },
    });

    view().dispatch({ changes: { from: 1, insert: "b" } });
    view().dispatch({ changes: { from: 2, insert: "c" } });

    expect(changes).toHaveLength(2);
    expect(changes[0].getDoc()).toBe("ab");
    expect(changes[1].getDoc()).toBe("abc");
    expect(editor.getDoc()).toBe("abc");
  });

  it("does not materialize the live document when setDoc receives an obviously different value", () => {
    const { editor, view } = mountWithCapturedView({
      doc: "alpha",
    });
    view().dispatch({ changes: { from: 5, insert: " beta" } });
    const toStringSpy = vi.spyOn(view().state.doc, "toString");

    editor.setDoc("short");

    expect(toStringSpy).not.toHaveBeenCalled();
    expect(editor.getDoc()).toBe("short");
  });
});
