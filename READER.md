# Reader and Document Context

The reader is the read-only FORMAT.md renderer in
`@chaoxu/coflat-editor`. It shares the parser, document semantics, theme
classes, and `DocumentContext` contract with the editor, but it does not
instantiate CodeMirror or React.

## Public Entries

The package exports map is the public contract:

- `@chaoxu/coflat-editor/reader`: `renderToHtml`, `renderToText`,
  reader helpers, and shared context types.
- `@chaoxu/coflat-editor/reader/worker`: worker entry for off-main-thread
  rendering.
- `@chaoxu/coflat-editor/parse`: parser and reference extraction helpers
  for hosts, CLIs, and indexers.
- `@chaoxu/coflat-editor/citeproc`: optional citation resolver helper.
- `@chaoxu/coflat-editor/themes/blueprint-book.css`: optional document
  theme stylesheet.

Everything outside the exports map is private.

## Document Context

`DocumentContext` is the host-owned read context shared by reader and editor
instances. It contains data that lives outside the current source string.

```ts
interface DocumentContext {
  fileSystem?: FileSystem;
  linkResolver?: LinkResolver;
  refResolver?: RefResolver;
  mathMacros?: Record<string, string>;
}
```

The context is fixed for the lifetime of a render or editor instance. If host
data changes, rerender or remount with a new context.

## File System

`FileSystem` lets the host resolve images, includes, and other workspace
assets. The library owns markdown parsing and source rewrites; the host owns
storage, permissions, URLs, and binary reads.

```ts
interface FileSystem {
  listTree(): Promise<FileEntry>;
  listChildren?(path: string): Promise<FileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileIfUnchanged?(
    path: string,
    content: string,
    expectedHash: string,
  ): Promise<ConditionalWriteResult>;
  createFile(path: string, content?: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  writeFileBinary(path: string, content: Uint8Array): Promise<void>;
  readFileBinary(path: string): Promise<Uint8Array>;
  resolveAssetUrl(path: string): string | Promise<string>;
}
```

## Links and References

The grammar is closed. Hosts do not add tokens. Hosts only resolve things the
document points at.

`LinkResolver` handles regular markdown links. The source already contains
the display text, so the host may rewrite the target and attach metadata.

```ts
interface LinkResolver {
  resolve?(
    href: string,
    text: string,
    env: { from?: string },
  ): {
    href?: string;
    className?: string;
    title?: string;
    onClick?: (event: MouseEvent) => void;
  } | null;
}
```

`RefResolver` handles citation/reference keys such as `[@knuth1984]` and
bare narrative refs such as `@knuth1984`. The source contains only the key, so
the host supplies both display content and optional target metadata.

```ts
interface RefResolver {
  resolve(
    key: string,
    mode: "bracketed" | "narrative",
  ): {
    content: string;
    href?: string;
    className?: string;
    onClick?: (event: MouseEvent) => void;
  } | null;
}
```

Same-document anchors and in-document cross-references are resolved by the
library. Links or references that depend on workspace state, bibliography
state, user directories, or app routes are resolved by the host.

## Reader Behavior

`renderToHtml(source, context?, options?)` returns sanitized HTML plus render
metadata such as `hasMath` and truncation offsets. It emits the same canonical
document classes used by editor surfaces so hosts can theme reader and editor
with one stylesheet.

`renderToText(source, context?, options?)` uses the same parser path when
needed and is intended for search indexing, snippets, notifications, and
plain-text previews.

The reader has a plain-inline fast path for common short fragments. More
structural input uses the Lezer parser. Math emits placeholders and reports
`hasMath`; UI wrappers can hydrate KaTeX only when needed.

## Sanitization

Reader HTML is sanitized before it is returned. Resolver-provided HTML is
treated as input, not trusted output. Hosts that need richer behavior should
provide click handlers or app-specific routes through resolvers rather than
injecting unchecked markup.

## Boundary

The library owns:

- FORMAT.md tokenization and parsing.
- In-document labels, cross-references, footnotes, math placeholders, and
  canonical document classes.
- Safe HTML and text rendering from a source string.

The host owns:

- Workspace storage and asset URLs.
- App routes and link behavior.
- Bibliography, page indexes, user directories, and other external reference
  data.
- Mounting, caching, and invalidation policy.
