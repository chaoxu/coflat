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

For finer-grained control, the lower-level CodeMirror primitives are also
re-exported from this package — `createEditor`, `editorModeField`,
`coflatTheme`, etc. See `src/editor/index.ts` in source for the full surface.

## Installation (Gitea registry)

Add to your `.npmrc`:
```
@chaoxu:registry=http://localhost:3001/api/packages/chaoxu/npm/
```

Then `pnpm add @chaoxu/coflat-editor`.
