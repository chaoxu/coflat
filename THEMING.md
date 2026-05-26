# Theming Coflat surfaces

Coflat exposes a stable set of `cf-*` class names plus documented CSS
custom properties. Hosts and applications own theme discovery,
persistence, user selection, CSS loading, and any theme-picker UI.
Coflat does not keep a theme registry or apply themes globally.

The package owns only the target contract:

- apply `cf-theme-scope` to the nearest root that should receive a theme
- apply a theme class or data attribute chosen by the host
- render full-document reader HTML inside `cf-reader cf-doc-surface
  cf-doc-flow`; document nodes carry canonical `cf-doc-*` classes
- mount editor instances inside the same scoped root when reader/editor
  should share a theme

This is intentionally scoped. A host can show two documents with two
different themes on the same page.

```html
<div class="cf-theme-scope cf-theme-blueprint-book" data-cf-theme="blueprint-book">
  <div class="cf-reader-shell">
    <aside class="cf-reader-toc">...</aside>
    <main class="cf-reader-document">
      <div class="cf-reader cf-doc-surface cf-doc-flow">
        <!-- renderToHtml(...) output -->
      </div>
    </main>
  </div>
</div>
```

`EditableReader` already uses `cf-theme-scope` on its root and
`cf-reader` on its read-mode output. Plain `renderToHtml` callers should
wrap the returned HTML themselves. Use the full reader wrapper above for
pages, long issue bodies, PR descriptions, and exported documents. For compact
snippets or comments, keep `cf-reader cf-doc-flow` and add a host-owned compact
class that overrides width, padding, and rhythm locally.

The default stylesheet is `@chaoxu/coflat-editor/style.css`. Optional
theme CSS is imported separately by hosts.

```ts
import "@chaoxu/coflat-editor/style.css";
import "@chaoxu/coflat-editor/themes/blueprint-book.css";
```

This file is the contract. Changes to the class names or to the
custom-property names below are breaking changes and bumped according
to semver.

## Theme manifests

Hosts may represent internal, user-authored, or marketplace themes with
the exported `CoflatThemeManifest` type. The manifest is descriptive:
Coflat never loads `css` entries or writes variables for the host.

```ts
import type { CoflatThemeManifest } from "@chaoxu/coflat-editor/reader";

const theme: CoflatThemeManifest = {
  id: "my-lab-theme",
  name: "My Lab Theme",
  targets: ["reader", "editor"],
  css: ["/themes/my-lab-theme.css"],
  rootClass: "my-lab-theme",
  dataTheme: "my-lab-theme",
  variables: {
    "--cf-content-max-width": "72ch",
  },
};
```

The bundled blueprint/book theme also has an exported manifest:

```ts
import { blueprintBookThemeManifest } from "@chaoxu/coflat-editor/reader";
```

## Class names

### Theme and reader shell

| Class | Element |
|---|---|
| `cf-theme-scope` | scoped root for host/user-applied variables and theme classes |
| `cf-reader-shell` | optional single-document reader layout wrapper |
| `cf-reader-toc` | optional host-rendered table of contents |
| `cf-reader-document` | document column wrapper inside a shell |
| `cf-reader` | wrapper around `renderToHtml` output |
| `cf-doc-surface` | shared reader/editor document surface colors |
| `cf-doc-flow` | shared reader/editor document typography |

### Block-level

| Class | Element |
|---|---|
| `cf-doc-heading cf-doc-heading--h1` … `--h6` | canonical heading classes on `<h1>` … `<h6>` and editor heading lines |
| `cf-doc-paragraph` | canonical paragraph class |
| `cf-doc-list cf-doc-list--unordered` | canonical `<ul>` classes |
| `cf-doc-list cf-doc-list--ordered` | canonical `<ol>` classes |
| `cf-doc-list--tight` / `cf-doc-list--loose` | added to `<ul>` / `<ol>` for spacing |
| `cf-doc-list--check` | added to `<ul>` / `<ol>` when items are task items |
| `cf-doc-list-item` | canonical `<li>` class |
| `cf-doc-list-item cf-doc-list-item--check` | task `<li>` (carries `data-checked="true|false"`) |
| `cf-doc-blockquote` | canonical `<blockquote>` class |
| `cf-doc-code-block` | canonical `<pre>` class (inner `<code>`; pre carries `data-lang`) |
| `cf-doc-block cf-doc-block--hr` | `<hr>` |
| `cf-doc-table-block` | canonical `<table>` class |
| `cf-doc-table-row` | `<tr>` |
| `cf-doc-table-cell` | `<td>` |
| `cf-doc-table-cell cf-doc-table-header` | `<th>` (header row cell) |
| `cf-doc-block cf-doc-block--{type}` | canonical semantic block classes |
| `cf-footnotes` | trailing `<ol>` listing footnote definitions |
| `cf-footnote-item` | each footnote `<li>` |
| `cf-doc-display-math` | block math placeholder |

### Inline

| Class | Element |
|---|---|
| `cf-doc-code-token` | canonical inline-code class |
| `cf-highlight` | `<mark>` |
| `cf-image` | `<img>` |
| `cf-footnote-ref` | `<sup>` wrapping the ref `<a>` |
| `cf-footnote-backref` | `<a>` linking back from the definition |
| `cf-doc-inline-math` | inline math placeholder |
| `cf-citation` | resolved citation `<span>` (when `RefResolver` returns a value) |
| `cf-citation-unresolved` | unresolved citation `<span>` (no resolver / null) |
| `cf-crossref-unresolved` | unresolved crossref `<span>` |
| `cf-crossref-{prefix}` | e.g. `cf-crossref-eq`, `cf-crossref-sec`, `cf-crossref-thm` |

## Reader/editor parity contract

Full-document reader output and CM6 rich mode share the same document
semantics. Themes should style shared `cf-doc-*` classes, shared runtime
classes such as `cf-math-*`, `cf-crossref-*`, `cf-citation-*`, and the
`--cf-*` tokens on `cf-theme-scope`. Avoid reader-only or CM6-only overrides
for prose, lists, tables, math, cross-references, and semantic blocks unless
the visual difference is intentional.

Math placeholders carry both the document class and runtime class
(`cf-doc-inline-math cf-math-inline`,
`cf-doc-display-math cf-math-display`). Display math always contains
`cf-math-display-content`, so themes can center and size display math once for
both surfaces. Fenced semantic block references are derived from the block
manifest prefixes (`thm`, `lem`, `prop`, `conj`, `def`, `prob`, `rem`, `ex`,
and related figure/table/algorithm prefixes), so new block types should add a
manifest prefix instead of teaching the reader and editor separately.

### Data attributes

| Attribute | Where |
|---|---|
| `data-lang` | `<pre class="cf-doc-code-block">` (info string) |
| `data-checked` | task `<li>` (`"true"` or `"false"`) |
| `data-math` | math placeholder (escaped raw source for hydration) |
| `data-align` | aligned table cells (also mirrored to inline `style="text-align:…"`) |
| `data-ref-key` | citation / crossref placeholder |
| `data-ref-mode` | citation placeholder (`"bracketed"` or `"narrative"`) |
| `data-source-line` | every block-level element (opt-in via `renderToHtml(_, _, { sourceLineAttribution: true })`) |
| `data-{key}` | fenced-div attribute key/value pairs flow through verbatim |

## CSS custom properties

The library stylesheet defines the shared theming surface. Hosts should
prefer overriding these on a `cf-theme-scope` container. `:root` still
works for application-wide defaults.

| Variable | Default purpose |
|---|---|
| `--cf-bg` | Document/application background. |
| `--cf-fg` | Body text color. |
| `--cf-muted` | Muted text and secondary UI. |
| `--cf-border` | Default border color. |
| `--cf-subtle` | Subtle surface background. |
| `--cf-hover` | Hover surface background. |
| `--cf-active` | Active surface background. |
| `--cf-accent` | Accent/link fallback color. |
| `--cf-accent-fg` | Text on accent. |
| `--cf-color-link` | `<a>` text color. |
| `--cf-color-code-bg` | Background for `cf-doc-code-block` and `cf-doc-code-token`. |
| `--cf-ui-font` | UI font stack. |
| `--cf-content-font` | Document/prose font stack. |
| `--cf-code-font` | Monospace stack for code blocks and inline code. |
| `--cf-base-font-size` | Reader/editor document base size. |
| `--cf-line-height` | Reader/editor document line height. |
| `--cf-content-max-width` | Reader/editor document column width. |
| `--cf-doc-content-padding-block-start` | Document top padding. |
| `--cf-doc-content-padding-block-end` | Document bottom padding. |
| `--cf-doc-content-padding-inline` | Document inline padding. |
| `--cf-doc-paragraph-margin` | Reader paragraph margin. |
| `--cf-doc-heading-margin` | Reader heading margin. |
| `--cf-doc-list-margin` | Reader list margin. |
| `--cf-doc-list-item-margin` | Reader list item margin. |
| `--cf-doc-code-block-margin` | Reader code block margin. |
| `--cf-doc-blockquote-margin` | Reader blockquote margin. |
| `--cf-h1-size` … `--cf-h6-size` | Heading sizes. |
| `--cf-h1-weight` … `--cf-h6-weight` | Heading weights. |
| `--cf-h1-style` … `--cf-h6-style` | Heading styles. |
| `--cf-block-{type}-accent` | Semantic block accent, e.g. `theorem`, `proof`. |
| `--cf-block-{type}-style` | Semantic block body font style. |
| `--cf-block-title-color` | Semantic block title color. |
| `--cf-block-title-weight` | Semantic block title weight. |
| `--cf-block-title-separator` | Separator after rendered block title. |
| `--cf-block-margin` | Semantic block margin. |
| `--cf-proof-marker` | Proof-ending marker. |
| `--cf-table-border` | Table cell border. |
| `--cf-table-header-border` | Table header border. |
| `--cf-table-cell-padding` | Table cell padding. |
| `--cf-table-font-size` | Table font size. |
| `--cf-table-line-height` | Table line height. |

The complete typed token list is exported from
`@chaoxu/coflat-editor` as `themeTokenNames`. External full-CSS themes
may use additional private variables under their own prefix.

## Example: host overrides link color

```css
.my-host-doc.cf-theme-scope {
  --cf-color-link: #c84600;
  --cf-color-code-bg: #faf6ef;
}
```

The host applies `.my-host-doc` to the container that wraps the
reader's output. The cascade does the rest — no JS coordination needed.

## Bundled blueprint/book theme

The optional blueprint/book theme is a single-document presentation
theme inspired by Lean blueprint output. It does not include dependency
graphs, Lean metadata, or a TeX/plasTeX compatibility layer.

```ts
import "@chaoxu/coflat-editor/style.css";
import "@chaoxu/coflat-editor/themes/blueprint-book.css";
```

Apply it on a scoped root:

```html
<div class="cf-theme-scope cf-theme-blueprint-book">
  <div class="cf-reader cf-doc-surface cf-doc-flow">...</div>
</div>
```

For an optional table of contents, use the reader shell classes shown at
the top of this document. The host owns TOC generation and selection UI.
