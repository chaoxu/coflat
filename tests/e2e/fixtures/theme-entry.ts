import "../../../src/editor/editor-theme.css";
import "../../../src/themes/blueprint-book.css";
import { renderToHtml } from "../../../reader";

const root = document.getElementById("theme-root");
if (!(root instanceof HTMLElement)) {
  throw new Error("missing #theme-root");
}

const source = `# Blueprint Document

## Main Result

::: {.theorem #main-result}
Every optimal document theme has a readable column.
:::

::: {.proof}
The host applies a scoped class, and Coflat surfaces inherit variables from it.
:::
`;

const { html } = renderToHtml(source);

root.innerHTML = `
  <div class="cf-theme-scope cf-theme-blueprint-book cf-reader-shell" data-cf-theme="blueprint-book">
    <aside class="cf-reader-toc" aria-label="Document outline">
      <a href="#main-result">Main Result</a>
    </aside>
    <main class="cf-reader-document">
      <div class="cf-doc-surface cf-doc-flow cf-reader">${html}</div>
    </main>
  </div>
`;
