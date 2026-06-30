import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { type EditorPlugin, EditorPluginManager } from "./editor-plugin";

describe("EditorPluginManager", () => {
  it("keeps lazy plugins out of the initial state and loads them after mount", async () => {
    const ready: string[] = [];
    const plugin: EditorPlugin = {
      id: "lazy-test",
      name: "Lazy Test",
      defaultEnabled: true,
      loadTiming: "after-mount",
      readyPhase: "lazy-test-ready",
      load: async () => EditorState.readOnly.of(true),
    };
    const manager = new EditorPluginManager([plugin], {
      onReady: (event) => ready.push(event.phase),
    });

    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "test",
        extensions: manager.initialExtensions(),
      }),
    });

    expect(view.state.facet(EditorState.readOnly)).toBe(false);

    manager.attach(view);
    await expect.poll(() => view.state.facet(EditorState.readOnly)).toBe(true);
    expect(ready).toContain("lazy-test-ready");

    view.destroy();
  });

  it("can enable lazy plugins on demand", async () => {
    const plugin: EditorPlugin = {
      id: "manual-test",
      name: "Manual Test",
      defaultEnabled: false,
      loadTiming: "manual",
      load: async () => EditorState.readOnly.of(true),
    };
    const manager = new EditorPluginManager([plugin]);
    const parent = document.createElement("div");
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "test",
        extensions: manager.initialExtensions(),
      }),
    });

    await manager.setEnabled(view, "manual-test", true);

    expect(view.state.facet(EditorState.readOnly)).toBe(true);
    view.destroy();
  });
});
