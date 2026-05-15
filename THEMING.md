# Theming the coflat reader

The reader emits a stable set of `cf-*` class names plus a documented
set of CSS custom properties on the renderer's stylesheet
(`dist/editor.css`, authored separately). Hosts override either layer
with the standard CSS cascade — no bespoke theming API.

This file is the contract. Changes to the class names or to the
custom-property names below are breaking changes and bumped according
to semver.

## Class names

### Block-level

| Class | Element |
|---|---|
| `cf-heading-1` … `cf-heading-6` | `<h1>` … `<h6>` |
| `cf-paragraph` | `<p>` |
| `cf-list cf-list-bullet` | `<ul>` |
| `cf-list cf-list-ordered` | `<ol>` |
| `cf-list-tight` / `cf-list-loose` | added to `<ul>` / `<ol>` for spacing |
| `cf-list-task` | added to `<ul>` / `<ol>` when items are task items |
| `cf-list-item` | `<li>` |
| `cf-list-item cf-list-task` | task `<li>` (carries `data-checked="true|false"`) |
| `cf-blockquote` | `<blockquote>` |
| `cf-code-block` | `<pre>` (inner `<code>`; pre carries `data-lang`) |
| `cf-hr` | `<hr>` |
| `cf-table` | `<table>` |
| `cf-table-row` | `<tr>` |
| `cf-table-cell` | `<td>` |
| `cf-table-cell cf-table-header` | `<th>` (header row cell) |
| `cf-fenced-div` + `cf-fenced-{classname}` | `<div>` for `::: {.classname …}` |
| `cf-footnotes` | trailing `<ol>` listing footnote definitions |
| `cf-footnote-item` | each footnote `<li>` |
| `cf-math cf-math-display` | block math placeholder |

### Inline

| Class | Element |
|---|---|
| `cf-code-inline` | `<code>` |
| `cf-highlight` | `<mark>` |
| `cf-image` | `<img>` |
| `cf-footnote-ref` | `<sup>` wrapping the ref `<a>` |
| `cf-footnote-backref` | `<a>` linking back from the definition |
| `cf-math cf-math-inline` | inline math placeholder |
| `cf-citation` | resolved citation `<span>` (when `RefResolver` returns a value) |
| `cf-citation-unresolved` | unresolved citation `<span>` (no resolver / null) |
| `cf-crossref-unresolved` | unresolved crossref `<span>` |
| `cf-crossref-{prefix}` | e.g. `cf-crossref-eq`, `cf-crossref-sec`, `cf-crossref-thm` |

### Data attributes

| Attribute | Where |
|---|---|
| `data-lang` | `<pre class="cf-code-block">` (info string) |
| `data-checked` | task `<li>` (`"true"` or `"false"`) |
| `data-math` | math placeholder (escaped raw source for hydration) |
| `data-align` | aligned table cells (also mirrored to inline `style="text-align:…"`) |
| `data-ref-key` | citation / crossref placeholder |
| `data-ref-mode` | citation placeholder (`"bracketed"` or `"narrative"`) |
| `data-source-line` | every block-level element (opt-in via `renderToHtml(_, _, { sourceLineAttribution: true })`) |
| `data-{key}` | fenced-div attribute key/value pairs flow through verbatim |

## CSS custom properties

The library stylesheet defines a minimum theming surface. Hosts override
these on `:root`, on a containing element, or anywhere else in the cascade.

| Variable | Default purpose |
|---|---|
| `--cf-color-text` | Body text color. |
| `--cf-color-link` | `<a>` text color. |
| `--cf-color-code-bg` | Background for `cf-code-block` and `cf-code-inline`. |
| `--cf-font-family` | Body font stack. |
| `--cf-font-family-code` | Monospace stack for code blocks and inline code. |
| `--cf-spacing-block` | Vertical spacing between block-level elements. |

Phase 2.x will add `--cf-color-bg`, table border / quote rule tokens,
and per-block fenced-div tokens (`--cf-color-warning`, `--cf-color-info`,
…). The names above are stable.

## Example: host overrides link color

```css
.my-host-doc {
  --cf-color-link: #c84600;
  --cf-color-code-bg: #faf6ef;
}
```

The host applies `.my-host-doc` to the container that wraps the
reader's output. The cascade does the rest — no JS coordination needed.
