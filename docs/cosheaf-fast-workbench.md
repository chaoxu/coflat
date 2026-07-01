# Cosheaf Fast Read/Edit Workbench

Use `@chaoxu/coflat/rich-readonly` for the first document surface in editable
Markdown routes. It renders through the same `renderToHtml` core as
`@chaoxu/coflat/reader` and uses the same `cf-doc-*` CSS classes as the editor
rich/read-only surface.

## Initial CSS

Load the shared document stylesheet before first paint:

```ts
import "@chaoxu/coflat/document-surface.css";
import "@chaoxu/coflat/themes/blueprint-book.css";
```

Use `@chaoxu/coflat/style.css` only when the editor is mounted. It includes
the document surface plus CodeMirror/editor chrome styling.

Keep the same theme wrapper that the existing workbench uses:

```html
<div class="cf-theme-scope cf-theme-blueprint-book">
  <div id="doc" class="cf-reader cf-doc-surface cf-doc-flow"></div>
</div>
```

`@chaoxu/coflat/themes/blueprint-book.css` is the packaged theme preset CSS.
The fast path and the CM6 editor share the same `cf-doc-*` document classes, so
the theme does not need a reader/editor fork.

## Server or Static HTML

Render the static document with `renderFastRichReadonlyHtml`:

```ts
import { renderFastRichReadonlyHtml } from "@chaoxu/coflat/rich-readonly";

const result = renderFastRichReadonlyHtml(source, context, {
  outline: true,
  referencePreviews: true,
  resolveReferences: true,
  sourcePositions: true,
});
```

Place `result.html` inside:

```html
<div class="cf-theme-scope">
  <div id="doc" class="cf-reader cf-doc-surface cf-doc-flow"></div>
</div>
```

The visible HTML is useful before any editor bundle loads.

## Block Plugin Presets

The fast reader and CM6 editor both use Coflat's built-in mathematical block
plugin preset. Cosheaf should keep per-document customization in frontmatter
`blocks`, not in a separate reader-only plugin list:

```yaml
---
blocks:
  theorem:
    numbered: true
    counter: theorem
  remark: false
---
```

That keeps theorem/proof/definition labels, counters, captions, reference
targets, and CSS classes aligned across `rich-readonly`, `reader`, and the
editor.

## Lightweight Hydration

Hydrate the already-visible DOM with:

```ts
import { hydrateRichReadonlyDocument } from "@chaoxu/coflat/rich-readonly";

await hydrateRichReadonlyDocument({
  root: document.getElementById("doc")!,
  source,
  context,
  result,
  hydration: {
    disclosures: true,
    media: true,
    references: true,
    math: result.hasMath,
    hoverPreviews: true,
  },
  onLifecycle(event) {
    performance.mark(`coflat:${event.phase}`);
  },
});
```

Lifecycle phases are:

- `first-document-pixels`
- `rich-readonly-ready`
- `outline-ready`
- `citations-ready`
- `math-ready`
- `editor-ready`

## Client-Only Mount

For client-only routes, `mountRichReadonlyDocument` inserts the rendered HTML
synchronously, then hydrates:

```ts
const mounted = mountRichReadonlyDocument({
  root,
  source,
  context,
  renderOptions: { outline: true, sourcePositions: true },
  onLifecycle: (event) => performance.mark(`coflat:${event.phase}`),
});

await mounted.ready;
```

## Editor Upgrade

When the user starts editing or when idle time is available, dynamically load
the editor entry:

```ts
const editor = await mounted.upgradeToEditor({
  mode: "rich-readonly",
  pluginPreset: "workbench",
  onFeatureReady(feature) {
    performance.mark(`coflat:editor:${feature}:ready`);
  },
  onPluginReady(event) {
    performance.mark(`coflat:plugin:${event.id}:${event.phase}`);
  },
});
```

`@chaoxu/coflat` mounts the editable CM6 document surface. Fenced-code language
packs load only when CodeMirror asks for that language. Optional workbench
features such as list outliner, reference autocomplete, and block picker are
editor plugins that attach after first editor mount.

The editor entry accepts:

- `pluginPreset: "core" | "workbench"`
- `plugins` for an explicit plugin descriptor list
- `extensions` for host-owned CM6 additions

Host integrations such as save handlers, request handlers, asset upload, and
autocomplete sources all live on this single editor entry.

## Package Boundary Check

Use the package graph smoke before migrating a route:

```sh
pnpm measure:package-graph
```

The check reports the static graph for `rich-readonly` and `editor`. It fails
if `rich-readonly` statically imports CodeMirror, React, CSL, PDF, or editor
chunks, or if `editor` statically imports fenced-code language packs,
context-menu UI, or block-picker UI.
