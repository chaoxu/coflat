import "katex/dist/katex.min.css";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import { hydrateMath, renderToHtml } from "../../reader";
import initialDoc from "./showcase.md?raw";
import "./style.css";

const editorRoot = document.querySelector<HTMLElement>("#editor");
const readerRoot = document.querySelector<HTMLElement>("#reader");

if (!editorRoot || !readerRoot) {
  throw new Error("Missing simple example roots.");
}

const editorContainer = editorRoot;
const readerContainer = readerRoot;

async function renderReader(source: string): Promise<void> {
  const { html } = renderToHtml(source);
  readerContainer.innerHTML = html;
  await hydrateMath(readerContainer);
}

await renderReader(initialDoc);

const editor = mountEditor({
  parent: editorContainer,
  doc: initialDoc,
  mode: "rich",
  onChange(source) {
    void renderReader(source);
  },
});

editor.focus();
