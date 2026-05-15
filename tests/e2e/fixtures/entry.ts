import { mountEditor } from "../../../editor";

const root = document.getElementById("editor-root");
if (!(root instanceof HTMLElement)) {
  throw new Error("missing #editor-root");
}

const mounted = mountEditor({
  parent: root,
  doc: "",
  mode: "source",
});

// Expose for assertions if needed by future specs.
(window as unknown as { __coflatEditor: typeof mounted }).__coflatEditor = mounted;
