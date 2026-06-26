import { describe, expect, it } from "vitest";

import { mountLazyEditor } from "./editor-lazy";

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
