import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@codemirror/view";

import { mountEditor, type MountedEditor } from "../../../editor";
import { createTestView, destroyAllTestViews } from "../test-utils";
import { createPerFilePanelApi } from "./per-file-panels";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  destroyAllTestViews();
});

function mount(doc: string): MountedEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editor = mountEditor({ parent, doc });
  cleanups.push(() => {
    editor.unmount();
    parent.remove();
  });
  return editor;
}

describe("mounted editor outline", () => {
  it("keeps plain text and source markdown for heading labels", () => {
    const editor = mount("# **Alpha** $a^2$ `Head` {#sec:alpha}\n\nbody");

    const [entry] = editor.outline.get();
    expect(entry).toMatchObject({
      level: 1,
      text: "Alpha $a^2$ Head",
      markdown: "**Alpha** $a^2$ `Head`",
      line: 1,
      from: 0,
      key: "0",
      id: "sec:alpha",
      number: "1",
    });
    expect(entry?.html).toContain('<strong class="cf-bold">Alpha</strong>');
    expect(entry?.html).toContain('aria-label="a^2"');
    expect(entry?.html).toContain("cf-doc-code-token");
  });

  it("renders outline html with resolved reference labels", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const editor = mountEditor({
      parent,
      doc: "# Proof of [@cor:rank-reduction-from-bounded-gap]\n\nbody",
      context: {
        refResolver: {
          resolve(key) {
            if (key !== "cor:rank-reduction-from-bounded-gap") return null;
            return { content: "Theorem 4", href: "#cor:rank-reduction-from-bounded-gap" };
          },
        },
      },
    });
    cleanups.push(() => {
      editor.unmount();
      parent.remove();
    });

    const [entry] = editor.outline.get();
    expect(entry?.markdown).toBe("Proof of [@cor:rank-reduction-from-bounded-gap]");
    expect(entry?.text).toBe("Proof of [@cor:rank-reduction-from-bounded-gap]");
    expect(entry?.html).toContain("Proof of ");
    expect(entry?.html).toContain("Theorem 4");
    expect(entry?.html).not.toContain("@cor:rank-reduction-from-bounded-gap");
  });

  it("uses the shared reader heading-anchor ids for generated outline anchors", () => {
    const editor = mount([
      "# Background",
      "",
      "## Setup {#background}",
      "",
      "# Méthodes & Results!",
      "",
      "# Méthodes & Results!",
    ].join("\n"));

    expect(editor.outline.get().map((entry) => entry.id)).toEqual([
      "background-2",
      "background",
      "methodes-results",
      "methodes-results-2",
    ]);
  });

  it("can emit the current outline to late subscribers", () => {
    const editor = mount("# Alpha\n\nbody");
    const values: string[][] = [];

    const unsubscribe = editor.outline.subscribe((outline) => {
      values.push(outline.map((entry) => entry.text));
    }, { emitCurrent: true });
    cleanups.push(unsubscribe);

    expect(values).toEqual([["Alpha"]]);
  });

  it("can mount with collapsed sidenotes and shared footnote section chrome", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const editor = mountEditor({
      parent,
      doc: "Text[^1].\n\n[^1]: Footnote body.",
      sidenotesCollapsed: true,
    });
    cleanups.push(() => {
      editor.unmount();
      parent.remove();
    });

    expect(parent.querySelector(".cf-footnote-section")).not.toBeNull();
    expect(parent.querySelector(".cf-bibliography-entry")).not.toBeNull();
  });
});

describe("mounted editor scroll helpers", () => {
  it("can scroll without moving the editor selection", () => {
    const editor = mount([
      "# Start",
      "",
      "middle paragraph",
      "",
      "# Target",
      "",
      "after",
    ].join("\n"));
    const target = editor.getDoc().indexOf("# Target");

    editor.scrollToPosition(target, { center: true, select: false });
    expect(editor.cursorContext.get().from).toBe(0);

    editor.scrollToLine(5, { select: false });
    expect(editor.cursorContext.get().from).toBe(0);

    editor.scrollToPosition(target);
    expect(editor.cursorContext.get().from).toBe(target);
  });
});

describe("per-file panel scroll helpers", () => {
  it("dispatches an explicit scroll effect when scrolling without selecting", () => {
    const panelApi = createPerFilePanelApi();
    const doc = [
      "# Start",
      "",
      "middle paragraph",
      "",
      "# Target",
      "",
      "after",
    ].join("\n");
    const target = doc.indexOf("# Target");
    const view = createTestView(doc, {
      cursorPos: 0,
      extensions: panelApi.extension,
    });
    const originalDispatch = view.dispatch.bind(view);
    const dispatchSpecs: Parameters<EditorView["dispatch"]> = [];
    view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
      dispatchSpecs.push(...specs);
      originalDispatch(...specs);
    }) as EditorView["dispatch"];
    panelApi.attach(view);

    panelApi.scrollToPosition(target, { select: false });

    expect(view.state.selection.main.head).toBe(0);
    expect(dispatchSpecs.some((spec) => "effects" in spec && spec.effects !== undefined)).toBe(true);
  });
});
