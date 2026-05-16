# @chaoxu/coflat-editor

Math-aware markdown editor library — CodeMirror 6 + Lezer + Typora-style ViewPlugins.
Extracted from the coflat project; consumed by both the coflat desktop shell
(Tauri) and the cosheaf web shell (Hono server).

## Quick start

```ts
import { mountEditor } from "@chaoxu/coflat-editor";
import "@chaoxu/coflat-editor/style.css";

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

## Classic CSL citations (`./citeproc`)

The main bundle no longer ships citation-js or CSL processing. Without a
citation formatter attached, `[@key]` and `@key` render as a degraded
placeholder (`<span class="cf-citation cf-citation-unresolved">…</span>`).
Hosts that want IEEE / APA / Chicago-style formatted citations import the
helper sub-entry:

```ts
import { mountEditor } from "@chaoxu/coflat-editor";
import "@chaoxu/coflat-editor/style.css";
import {
  parseBibTeX,
  CslProcessor,
  createCslCitationFormatter,
  bibDataEffect,
} from "@chaoxu/coflat-editor/citeproc";

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

## Installation (Gitea registry)

Add to your `.npmrc`:
```
@chaoxu:registry=http://localhost:3001/api/packages/chaoxu/npm/
```

Then `pnpm add @chaoxu/coflat-editor`.
