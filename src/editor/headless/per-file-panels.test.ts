import { afterEach, describe, expect, it } from "vitest";

import { mountEditor, type MountedEditor } from "../../../editor";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
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

    expect(editor.outline.get()).toEqual([
      {
        level: 1,
        text: "Alpha $a^2$ Head",
        markdown: "**Alpha** $a^2$ `Head`",
        line: 1,
        from: 0,
        key: "0",
        id: "sec:alpha",
        number: "1",
      },
    ]);
  });
});
