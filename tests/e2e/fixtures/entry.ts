import { mountEditor } from "../../../editor";
import { requiredHTMLElement } from "./utils";

const root = requiredHTMLElement("editor-root");

const mounted = mountEditor({
  parent: root,
  doc: "",
  mode: "source",
});

// Expose for assertions if needed by future specs.
(window as unknown as { __coflatEditor: typeof mounted }).__coflatEditor = mounted;
