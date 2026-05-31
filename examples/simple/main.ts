import "katex/dist/katex.min.css";
import "../../src/editor/editor-theme.css";
import { mountEditor } from "../../editor";
import { hydrateMath, renderToHtml } from "../../reader";
import "./style.css";

const initialDoc = `# Coflat Editor

Write Markdown with inline math like $a^2 + b^2 = c^2$.

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`;

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
