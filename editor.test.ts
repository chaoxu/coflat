import { describe, expect, it, vi } from "vitest";

import { DOCUMENT_SURFACE_CLASS } from "./src/core/document-surface-classes";
import { mountEditor } from "./editor";

describe("mountEditor", () => {
  it("mounts with an empty document by default", () => {
    const parent = document.createElement("div");

    const editor = mountEditor({ parent });

    expect(editor.getDoc()).toBe("");
    expect(editor.getMode()).toBe("rich");
    const editorElement = parent.querySelector(".cm-editor");
    expect(editorElement).toBeTruthy();
    expect(editorElement?.classList.contains(DOCUMENT_SURFACE_CLASS.surface)).toBe(true);
    const contentElement = parent.querySelector(".cm-content");
    expect(contentElement?.classList.contains(DOCUMENT_SURFACE_CLASS.flow)).toBe(true);

    editor.unmount();
  });

  it("applies the requested initial source mode without firing mode callbacks", () => {
    const onModeChange = vi.fn();
    const parent = document.createElement("div");

    const editor = mountEditor({
      parent,
      doc: "# Title",
      mode: "source",
      onModeChange,
    });

    expect(editor.getMode()).toBe("source");
    expect(onModeChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it("applies the requested initial rich-readonly mode without firing mode callbacks", () => {
    const onModeChange = vi.fn();
    const parent = document.createElement("div");

    const editor = mountEditor({
      parent,
      doc: "# Title",
      mode: "rich-readonly",
      onModeChange,
    });

    expect(editor.getMode()).toBe("rich-readonly");
    expect(parent.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    expect(onModeChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it("setDoc replaces fenced content without triggering onChange", () => {
    const onChange = vi.fn();
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "::: {.theorem}\nBody\n:::",
      onChange,
    });

    editor.setDoc("# Replaced");

    expect(editor.getDoc()).toBe("# Replaced");
    expect(onChange).not.toHaveBeenCalled();

    editor.unmount();
  });

  it("reports programmatic mode changes through onModeChange", () => {
    const onModeChange = vi.fn();
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      onModeChange,
    });

    editor.setMode("source");
    editor.setMode("rich-readonly");
    editor.setMode("rich");

    expect(onModeChange.mock.calls).toEqual([["source"], ["rich-readonly"], ["rich"]]);

    editor.unmount();
  });

  it("exposes synchronous headless outline data after mount", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "# Intro {#sec:intro}\n\nBody\n\n## Lemma\nText",
    });

    expect(editor.outline.get()).toEqual([
      {
        level: 1,
        text: "Intro",
        markdown: "Intro",
        html: "Intro",
        line: 1,
        from: 0,
        key: "0",
        id: "sec:intro",
        number: "1",
      },
      {
        level: 2,
        text: "Lemma",
        markdown: "Lemma",
        html: "Lemma",
        line: 5,
        from: 28,
        key: "28",
        id: "lemma",
        number: "1.1",
      },
    ]);

    editor.unmount();
  });

  it("reports a visible source position for host read/edit mapping", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "# Intro\n\nBody\n\nTail",
    });

    const position = editor.getVisibleSourcePosition({ viewportRatio: 0 });

    expect(position).not.toBeNull();
    expect(position?.pos).toBeGreaterThanOrEqual(0);
    expect(position?.line).toBeGreaterThanOrEqual(1);

    editor.unmount();
    expect(editor.getVisibleSourcePosition()).toBeNull();
  });

  it("publishes headless outline updates without rendering panel DOM", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "# Intro",
    });
    const onOutline = vi.fn();

    const unsubscribe = editor.outline.subscribe(onOutline);
    editor.setDoc("# Intro\n\n## Details");

    expect(onOutline).toHaveBeenCalledTimes(1);
    expect(onOutline.mock.calls[0][0].map((entry) => entry.text)).toEqual([
      "Intro",
      "Details",
    ]);
    expect(parent.querySelector(".cf-outline")).toBeNull();

    unsubscribe();
    editor.setDoc("# Intro\n\n## Details\n\n### Tail");
    expect(onOutline).toHaveBeenCalledTimes(1);

    editor.unmount();
  });

  it("exposes counts for the markdown body", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "---\ntitle: Draft\n---\nOne two.\n\nThree.",
    });

    expect(editor.counts.get()).toEqual({
      words: 3,
      chars: "One two.\n\nThree.".length,
      paragraphs: 2,
    });

    editor.unmount();
  });

  it("updates cursor context on line-oriented navigation", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "# Chapter\n\n## Section\nBody text",
    });
    const onCursorContext = vi.fn();

    const unsubscribe = editor.cursorContext.subscribe(onCursorContext);
    editor.scrollToLine(4, { column: 6 });

    expect(editor.cursorContext.get()).toEqual({
      line: 4,
      column: 6,
      from: 27,
      currentHeadingPath: ["Chapter", "Section"],
    });
    expect(onCursorContext).toHaveBeenCalledWith(editor.cursorContext.get());

    unsubscribe();
    editor.unmount();
  });

  it("clears headless subscribers on unmount", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "# Intro",
    });
    const onCounts = vi.fn();

    editor.counts.subscribe(onCounts);
    editor.unmount();
    editor.setDoc("# Changed");

    expect(onCounts).not.toHaveBeenCalled();
  });

  it("updates DocumentContext after mount without remounting document state", () => {
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "See [@host-page].",
      mode: "rich",
    });

    expect(editor.getDoc()).toBe("See [@host-page].");
    expect(parent.textContent).not.toContain("Resolved Page");

    editor.setContext({
      refResolver: {
        resolve: (key) => ({ content: `<strong>Resolved ${key}</strong>` }),
      },
    });

    expect(editor.getDoc()).toBe("See [@host-page].");
    expect(editor.getMode()).toBe("rich");
    expect(parent.textContent).toContain("Resolved host-page");

    editor.unmount();
  });

  it("includes hover preview support for standalone mounts", () => {
    vi.useFakeTimers();
    const parent = document.createElement("div");
    const editor = mountEditor({
      parent,
      doc: "$$x$$ {#eq:one}\n\nSee [@eq:one].",
      mode: "rich",
    });

    try {
      const reference = parent.querySelector<HTMLElement>("[data-reference-widget]");
      expect(reference?.textContent).toBe("Eq. (1)");

      reference?.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true,
        relatedTarget: null,
      }));
      vi.advanceTimersByTime(350);

      expect(document.querySelector(".cf-hover-preview-tooltip")).toBeTruthy();
    } finally {
      editor.unmount();
      document.querySelector(".cf-hover-preview-tooltip")?.remove();
      vi.useRealTimers();
    }
  });
});
