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
});
