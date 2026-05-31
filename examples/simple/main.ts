import "katex/dist/katex.min.css";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import initialDoc from "./showcase.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");

if (!editorRoot) {
  throw new Error("Missing simple example roots.");
}

const editor = mountEditor({
  parent: editorRoot,
  doc: initialDoc,
  mode: "rich",
});

editor.focus();
