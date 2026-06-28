import { describe, expect, it } from "vitest";

import { mountLazyEditor } from "./editor-lazy";

function dispatchHeldEnter(parent: HTMLElement, repeats: number): void {
  const content = parent.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("missing editor content");
  content.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    bubbles: true,
    cancelable: true,
    repeat: false,
  }));
  for (let i = 0; i < repeats; i += 1) {
    content.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      repeat: true,
    }));
  }
}

describe("@chaoxu/coflat/editor-lazy", () => {
  it("mounts an editable rich editor and reports lazy feature readiness", async () => {
    const parent = document.createElement("div");
    const ready: string[] = [];

    const editor = mountLazyEditor({
      parent,
      doc: "# Intro\n\nbody",
      onLazyFeatureReady: (feature) => ready.push(feature),
    });

    expect(parent.querySelector(".cm-editor")).not.toBeNull();
    expect(editor.getDoc()).toBe("# Intro\n\nbody");

    await expect.poll(() => ready).toContain("block-type-picker");

    editor.unmount();
    expect(parent.querySelector(".cm-editor")).toBeNull();
  });

  it("treats held Enter repeat as repeated list editing immediately after mount", () => {
    const parent = document.createElement("div");
    const editor = mountLazyEditor({
      parent,
      doc: "- item",
      mode: "rich",
    });

    editor.scrollToPosition("- item".length);
    editor.focus();
    dispatchHeldEnter(parent, 3);

    expect(editor.getDoc()).toBe("- item\n\n\n\n");

    editor.unmount();
  });

  it("can mount directly in read-only rich mode", () => {
    const parent = document.createElement("div");
    const editor = mountLazyEditor({
      parent,
      doc: "# Intro\n\nbody",
      mode: "rich-readonly",
    });

    expect(parent.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");

    editor.unmount();
  });

  it("exposes host save state and headless panels without the full editor entry", async () => {
    const parent = document.createElement("div");
    const saves: string[] = [];
    const dirty: boolean[] = [];

    const editor = mountLazyEditor({
      parent,
      doc: "# Intro\n\nbody",
      saveHandler: {
        save: async ({ source, reason }) => {
          saves.push(`${reason}:${source}`);
          return { ok: true };
        },
      },
      statusEvents: {
        onDirtyChange: (next) => dirty.push(next),
      },
    });

    expect(editor.outline.get().map((entry) => entry.text)).toEqual(["Intro"]);
    expect(editor.counts.get().words).toBe(2);
    expect(editor.isSaved()).toBe(true);

    editor.setDoc("# Intro\n\nchanged");
    expect(editor.isSaved()).toBe(false);
    await editor.triggerSave("manual");

    expect(saves).toEqual(["manual:# Intro\n\nchanged"]);
    expect(dirty.at(-1)).toBe(false);
    expect(editor.isSaved()).toBe(true);

    editor.unmount();
  });

  it("does not expose a retained CodeMirror view after unmount", () => {
    const parent = document.createElement("div");
    const editor = mountLazyEditor({
      parent,
      doc: "# Intro\n\nbody",
    });

    expect("view" in editor).toBe(false);
    editor.unmount();
    expect("view" in editor).toBe(false);
  });
});
