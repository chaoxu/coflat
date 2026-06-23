# @chaoxu/coflat

Math-aware markdown editor library — CodeMirror 6 + Lezer + Typora-style ViewPlugins.
Extracted from the Coflat Shell project; consumed by both Coflat Shell
(Tauri) and the cosheaf web shell (Hono server).

## Try it

The live showcase example is on GitHub Pages:

<http://chaoxu.prof/coflat/>

Run the same page locally:

```sh
pnpm install
pnpm dev:pages
```

## Quick start

```ts
import { mountEditor } from "@chaoxu/coflat";
import "@chaoxu/coflat/style.css";

const editor = mountEditor({
  parent: document.getElementById("root")!,
  doc: "# Hello\n\n$\\int_0^1 x\\,dx$",
  mode: "rich",
  onChange: (next) => console.log(next),
});
```

## Headless Per-File Panels

`mountEditor` also exposes per-file derived state without rendering any
panels, sidebars, CSS, or chrome. Hosts own the UI and subscribe to editor
state:

```ts
const editor = mountEditor({ parent, doc });

renderOutline(editor.outline.get());

const unsubscribe = editor.outline.subscribe((outline) => {
  renderOutline(outline);
});

// Line and column values are 1-based. `from` offsets are 0-based CodeMirror
// document positions for exact editor navigation.
editor.scrollToLine(12, { column: 1 });
editor.scrollToPosition(editor.outline.get()[0]?.from ?? 0);

unsubscribe();
editor.unmount();
```

Available stores:

- `editor.outline`: `{ level, text, line, from, key, id?, number? }[]`
- `editor.counts`: `{ words, chars, paragraphs }`
- `editor.cursorContext`: `{ line, column, from, currentHeadingPath }`

`subscribe` returns an unsubscribe function. All remaining subscriptions are
cleared by `editor.unmount()`. The API is additive, so existing consumers that
only use `getDoc`, `setDoc`, `getMode`, `setMode`, `focus`, or `unmount` keep
working unchanged.

For finer-grained control, the lower-level CodeMirror primitives are also
re-exported from this package — `createEditor`, `editorModeField`,
`coflatTheme`, `createPerFilePanelApi`, etc. See `src/editor/index.ts` in
source for the full surface.

## Reference resolution and CSL helpers (`./citeproc`)

The main bundle no longer ships citation-js or CSL processing. `[@key]` and
`@key` default to cross-reference rendering; hosts that want display text and
targets attach a `refResolver`. The `./citeproc` helper remains available for
hosts that explicitly build IEEE / APA / Chicago-style citation formatting:

```ts
import { mountEditor } from "@chaoxu/coflat";
import "@chaoxu/coflat/style.css";
import {
  parseBibTeX,
  CslProcessor,
  createCslCitationFormatter,
  bibDataEffect,
} from "@chaoxu/coflat/citeproc";

const items = parseBibTeX(await fetch("/refs.bib").then((r) => r.text()));
const processor = await CslProcessor.create(items /*, optional CSL XML */);
const editor = mountEditor({ parent: el });

editor.view.dispatch({
  effects: bibDataEffect.of({
    store: new Map(items.map((i) => [i.id, i])),
    formatter: createCslCitationFormatter(processor),
  }),
});
```

`citation-js` and its CSL/locale fixtures only enter the runtime graph when
this sub-entry is imported.

## Installation

This repository is public and should build from a normal checkout:

```sh
git clone https://github.com/chaoxu/coflat.git
cd coflat
pnpm install
pnpm build
```

Internal fleet packages are published to the Gitea npm registry:

```ini
@chaoxu:registry=http://packages.lab/api/packages/chaoxu/npm/
```

Publish a new version from a clean checkout on `jupiter`:

```sh
pnpm publish:gitea
```

The publish command creates a temporary package-scoped Gitea token on `jupiter`
and removes it after `npm publish` exits. From another host, set
`GITEA_NPM_TOKEN` to a token with `write:package`.

For unpublished local changes, consume Coflat from a workspace or sibling
checkout:

```json
{
  "dependencies": {
    "@chaoxu/coflat": "file:../coflat"
  }
}
```

Do not commit private registry credentials in this repository.

## Package Smoke Check

The package smoke target builds the public package and verifies that the
bundled reader can render the showcase fixture with the expected document
surface classes and stylesheet rules:

```sh
pnpm check:package-smoke
```

## Parity Checks

The fast browser suite excludes the external corpus gate:

```sh
pnpm test:e2e
```

Run the Cosheaf reader/editor parity corpus explicitly when changing shared
document rendering, theme CSS, or reader/editor reference behavior:

```sh
pnpm test:e2e:corpus
```

The corpus runner uses `COFLAT_PARITY_CORPUS_DIR` when set, otherwise it looks
for `/tmp/coflat-poa-network-game-clean` and `../poa-network-game-clean`. The
runner splits the corpus into independent Playwright tests so workers can run
semantic checks for every chunk and pixel checks for every chunk across the
default surface and every non-default theme preset. Pass Playwright options
after `--`; for example, `pnpm test:e2e:corpus -- --workers=10` overrides the
runner's local worker default.

## Package architecture

The source is organized in three internal layers, enforced by
`scripts/check-layer-boundary.mjs`:

| Layer | Path | Allowed deps | Public via |
|---|---|---|---|
| **core** | `src/core/` | pure: no CodeMirror, no React, no dompurify, no KaTeX | `./parse`, `./citeproc` |
| **reader** | `src/reader/` | + dompurify; KaTeX dynamic-only | `./reader`, `./reader/worker` |
| **editor** | `src/editor/` | + CodeMirror, React | `.` (root) |

The layout is package-extraction ready: if a consumer ever needs the
parser without the editor, or the reader without CodeMirror, the layers
extract cleanly into `@chaoxu/coflat-format`, `@chaoxu/coflat-reader`,
and `@chaoxu/coflat` as separate npm packages. Until then, one
package with explicit sub-path exports is enough.

## Stable contracts

The following surfaces are part of the package's public API and follow
semver. Breaking changes get a major version bump.

### `DocumentContext` (host extension point)

```ts
import type {
  DocumentContext,
  LinkResolver,
  RefResolver,
  CitationFormatter,
} from "@chaoxu/coflat/reader";
```

`DocumentContext` is the single seam through which a host (e.g. cosheaf,
a static site generator, a CLI tool) injects link resolution, citation
formatting, asset URL resolution, and math macros. Both `renderToHtml`
(reader) and `mountEditor` (editor) accept it. The shape is intentionally
small; new optional fields may be added, existing ones won't change
without a major version.

- `linkResolver?(href, text, env) → { href, className, title, onClick } | null`
  — host gets to decorate `[text](href)` markdown links.
- `refResolver?(key, mode: "bracketed" | "narrative") → { content, href, ... } | null`
  — host produces both display text and target for `[@key]` / `@key`.
- `citationFormatter?` — optional CSL helper state for hosts that explicitly
  build citation formatting on top of reference handling.
- `mathMacros?` — `Record<string, string>` of KaTeX macros.
- `fileSystem?` — abstract filesystem for asset URL resolution.

A workspace that doesn't need a feature simply omits the field. Hosts
that need to swap resolvers (new bib loaded, new page added) remount
their instance.

### `renderToHtml` source-line attribution

```ts
const { html } = renderToHtml(source, ctx, {
  sourceLineAttribution: true,
});
```

When enabled, the rendered HTML carries `data-source-line="N"` attributes
on every block-level element, mapping back to its 1-indexed line in
`source`. This is the contract hosts rely on for side-by-side diff
rendering, scroll-sync, and source-to-output mapping. The attribute name
and 1-indexing are stable; new attributes (e.g. `data-source-column`)
may be added in minor versions.

The reader also exposes `mapDomRangeToSource(range, sourceToText)` for
the reverse direction (DOM range → source offsets). The signature is
stable.

### Scoped reader/editor themes

Coflat owns stable `cf-*` classes and `--cf-*` CSS variables, but hosts
own theme management. Apply themes on a scoped container so separate
documents can use separate themes:

```html
<div class="cf-theme-scope my-theme">
  <div class="cf-reader cf-doc-surface cf-doc-flow">...</div>
</div>
```

Hosts can load their own CSS or use optional package themes:

```ts
import "@chaoxu/coflat/style.css";
import "@chaoxu/coflat/themes/blueprint-book.css";
```

The exported `CoflatThemeManifest` type describes external theme
metadata. See `THEMING.md` for the root classes, manifest shape, and the
bundled `blueprintBookThemeManifest`.

## Building a minimal editor host

If you want to integrate coflat content into a context that can't (or
shouldn't) load the full 600 KB CodeMirror editor — e.g. a Forgejo-style
read-mostly UI, a CLI preview, or a textarea-based comment box — the
reader is the only piece you need.

A minimal reader-only host looks like this (~30 lines):

```tsx
import { useEffect, useRef } from "react";
import { hydrateBlockDisclosures, hydrateMath, renderToHtml, type DocumentContext } from "@chaoxu/coflat/reader";

export function CoflatViewer({ source, context }: { source: string; context: DocumentContext }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const { html } = renderToHtml(source, context);
    ref.current.innerHTML = html;
    hydrateBlockDisclosures(ref.current);
    // Optional: hydrate math placeholders with KaTeX (loaded on demand).
    void hydrateMath(ref.current, { mathMacros: context.mathMacros });
  }, [source, context]);
  return <div ref={ref} className="coflat-content" />;
}
```

For a textarea-based editor that produces coflat source (no live preview,
no rich rendering, just save-on-blur):

```tsx
export function TextareaEditor({
  initialValue,
  onSave,
}: {
  initialValue: string;
  onSave: (text: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <textarea
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(value)}
      style={{ width: "100%", minHeight: "400px", fontFamily: "monospace" }}
    />
  );
}
```

These are reference examples; they're not exported from the package.
Copy and adapt as needed.
