import "../../../src/editor/editor-theme.css";
import { applyThemePreset, mountEditor, themePresets } from "../../../editor";
import { hydrateMath, renderToHtml } from "../../../reader";

const params = new URLSearchParams(window.location.search);
const presetKey = params.get("preset");
if (presetKey && presetKey in themePresets) {
  applyThemePreset(themePresets[presetKey]);
}
document.body.dataset.surface = params.get("surface") ?? "split";

const source = `# Default Document

This paragraph includes **bold text**, *italic text*, ~~struck text~~,
==highlighted text==, \`inline code\`, $x + y$, and a
[reference link](https://example.com).

## Main Result

### Supporting Lemma

- unordered item
- [x] completed task

3. ordered item

| Name | Value |
| --- | ---: |
| Alpha | 1 |

\`\`\`ts
const value = 1;
\`\`\`

$$
x^2 + y^2 = z^2
$$

::: {.definition #def-theme title="Scoped theme"}
A default theme is applied by the host on the nearest scoped root.
:::

::: {.theorem #main-result title="Readable column"}
Every optimal document theme has a readable column and stable theorem rails.
:::

::: {.proof title="the readable column theorem"}
The host applies a scoped class, and Coflat surfaces inherit variables from it.
:::
`;

const readerRoot = document.getElementById("reader-root");
const editorRoot = document.getElementById("editor-root");
if (!(readerRoot instanceof HTMLElement) || !(editorRoot instanceof HTMLElement)) {
  throw new Error("missing parity fixture roots");
}

readerRoot.innerHTML = renderToHtml(source).html;
await hydrateMath(readerRoot);

const mounted = mountEditor({
  parent: editorRoot,
  doc: source,
  mode: "rich",
});

(window as unknown as { __coflatEditor: typeof mounted }).__coflatEditor = mounted;
