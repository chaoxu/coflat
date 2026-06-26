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
});
