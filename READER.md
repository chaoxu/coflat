# Reader and shared document context

Design note for two related additions to `@chaoxu/coflat-editor`:

1. A read-only renderer (the "reader") that turns a FORMAT.md string
   into HTML, reusing the editor's parser and semantics but skipping
   CodeMirror entirely. For previews, diff bodies, search snippets,
   notification bodies, and any host that wants to display large numbers
   of FORMAT.md fragments cheaply.
2. A shared `DocumentContext` consumed by both the reader and the
   editor, so that multiple live instances on the same host page resolve
   links and references against the same host-supplied resolvers without
   each instance reinitializing them.

The reader is the forcing function, but the context model applies to
the editor equally. The motivating downstream is `cosheaf` (a wiki
where each page may have thousands of FORMAT.md comments and inline
editors), but nothing in this design is cosheaf-specific. The library
should be drop-in usable in any host.

Status: proposal. Nothing built yet.

## Why a separate reader

The editor is built on CodeMirror 6 + Lezer + KaTeX, with React,
zustand, pdfjs, and CM language packages as peers. It is the right tool
for authoring, but wrong for rendering 1000 fragments on a page:

- CM6 instantiates an `EditorView` per surface. State, transactions,
  view plugins, decorations — all of that is overhead for static text.
- The editor's rendering pipeline emits CM `Decoration`s, not HTML
  strings. There is nothing to cache between mounts.
- Peer-dep weight (CM6 + lang packages + pdfjs) is wasted on a reader.

We want a renderer that:

1. Takes a FORMAT.md string + a small context object and returns HTML
   (or a React node).
2. Has a fast path for the common short-fragment shape (a few sentences,
   maybe inline code, maybe a link).
3. Loads KaTeX lazily, only when math is present and visible.
4. Reuses the editor's parser and semantics so dialect support stays
   bit-identical (fenced divs, equation labels, footnotes, citations,
   cross-refs).
5. Produces output the host can cache by content hash.

Non-goals: selection, IME, undo, autocomplete, syntax highlighting in
input, LSP. None of that belongs in a reader.

## Design premises

Three premises drive the rest of this note. All deliberate and tight.

**The parser is closed.** Hosts cannot add tokens. The FORMAT.md grammar
is fixed by coflat (Pandoc Markdown + pandoc-crossref + the extensions
documented in `FORMAT.md`). If a host wants new syntax, that's a grammar
change in coflat, not a host plugin. This keeps escape rules, code-span
exclusion, and Lezer conflict resolution in one place.

**The host owns "what lives outside this document."** Links go somewhere;
`@`-style references name something. Coflat tokenizes them; coflat
formats them; but it does not know what they point to. That knowledge is
host-supplied through two narrow seams (`LinkResolver`, `RefResolver`,
described below). Bibliography processing, page indexes, user
directories, issue trackers — all host concerns, not coflat's.

**Lezer is the parser. Regex is a sieve.** Every place coflat tokenizes
FORMAT.md syntax uses the Lezer/markdown parser. Regex is reserved for
non-structural sieves where regex actually fits: rejecting trivial
fragments in the reader's fast path (does this source contain any
interesting character at all?), splitting frontmatter delimiters from
body, URL shape validation, simple character-class scans. Anything that
extracts a token, computes a range, or makes a "this is or isn't X"
syntactic claim goes through the parser. This rule applies to coflat
*and* to external consumers of `extractReferences`: indexers, CLIs, and
MCPs use the parse entry, not their own regex.

A Phase 0 audit task: walk existing regex usage in
`src/lib/markdown/`, `src/semantics/`, `src/references/`, and convert
anything that's effectively a tokenizer to a Lezer node walk. Leave
regex in place where it's a sieve, a delimiter check, or a non-syntactic
scan (URL shape, frontmatter `---` boundary).

## The host extension surface

Three injectable pieces, all optional:

```ts
type DocumentContext = {
  fileSystem?: FileSystem;        // image / include / asset I/O
  linkResolver?: LinkResolver;    // [text](href) — host owns target + click
  refResolver?: RefResolver;      // [@key], @key — host owns display + click
  mathMacros?: Record<string, string>;  // usually comes from frontmatter
};

interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;
  // Host-controlled URL/blob resolution for asset references like
  // <img src="..."> or background images. Returns the URL coflat emits
  // into the DOM. Hosts can return CDN URLs, blob URLs, or
  // signed/auth'd URLs without coflat needing to know.
  resolveAssetUrl(path: string): string | Promise<string>;
}

interface LinkResolver {
  // Called per [text](href). Return null to fall through to default <a>.
  // Synchronous; context is fixed for the lifetime of the render.
  // `env.from` is the path of the document currently being rendered,
  // so relative hrefs (./other.md) can be resolved against it. Bare
  // same-document anchors (href="#eq:foo") are routed to coflat's
  // internal anchor resolver and never reach LinkResolver.
  resolve?(
    href: string,
    text: string,
    env: { from?: string },
  ): {
    href?: string;                // rewrite target (e.g. internal route)
    className?: string;           // styling: internal, external, broken
    title?: string;               // tooltip / hover preview
    onClick?: (e: MouseEvent) => void;
  } | null;
}

interface RefResolver {
  // Called per [@key] (bracketed / parenthetical) and @key (narrative).
  // Host produces BOTH display text and (optional) target.
  // Synchronous; context is fixed for the lifetime of the render.
  resolve(key: string, mode: "bracketed" | "narrative"): {
    content: string;              // sanitized HTML (passes through dompurify)
    href?: string;
    className?: string;
    onClick?: (e: MouseEvent) => void;
  } | null;
}
```

That is the entire host-facing surface. Everything else is coflat-owned.

**v1 assumption: context is immutable for the render lifetime.** Hosts
build `DocumentContext` once at page load and never mutate it. If the
underlying data changes (a new bib entry, a new page added to the
workspace), the host remounts. This is acceptable because bib edits and
workspace-shape changes are rare relative to render frequency. When that
assumption breaks, a follow-up issue adds `version()` / `subscribe()` to
the resolver interfaces. Until then, both resolvers are pure functions
of their input.

Note that coflat's *internal* cross-ref index does update during editing
(adding `{#eq:foo}` mid-typing reflows numbering for sibling instances).
That's coflat-internal reactivity using CM6's transaction model, not
exposed through `DocumentContext`.

### Why `LinkResolver` and `RefResolver` are distinct

The shapes look similar but the load is different:

- `[text](href)`: display text lives in the source. The host *decorates*
  the link — rewrites href, attaches className/onClick, adds a tooltip.
  The host does not produce the text.
- `[@key]` / `@key`: the source has only a key. The host produces **both
  the display text and the target.** "Knuth 1984," "Section 3.2," "Page
  Title," "@chao" — none of that text exists in the document.

Same family, two different obligations. Conflating them forces every
host to handle a discriminated union; separating them keeps each
interface small.

`mode` matters for `RefResolver` because Pandoc citations render
differently in bracketed vs. narrative position (`[@knuth1984]` → "(Knuth
1984)"; bare `@knuth1984` → "Knuth (1984)"). A host that doesn't care
about that distinction can ignore the parameter.

### What stays inside coflat

These are decided internally, not negotiable through a resolver:

- **Tokenization of all FORMAT.md syntax** — including `[@key]`, `@key`,
  `@eq:foo`, `@sec:bar`, `$...$`, `$$...$$`, fenced divs, footnotes,
  links, images. Closed grammar.
- **Cross-ref resolution.** `@eq:pythag` finds `{#eq:pythag}` *in this
  document* (or in included files reached via `FileSystem`). The data
  source is the document itself; no host involvement. Coflat scans
  labels, computes numbering, renders "(3)".
- **Math compilation.** KaTeX, with macros from frontmatter or
  `ctx.mathMacros`. No host swap point in v1.
- **Code highlighting.** Coflat picks a highlighter for the reader; the
  editor reuses its existing CM language packages.
- **Image rendering.** Coflat emits `<img src={url}>` where `url` comes
  from `FileSystem.resolveAssetUrl(path)`. Hosts return CDN URLs, blob
  URLs, signed URLs, or whatever — coflat doesn't need to know. Lazy
  loading is a coflat default; broken-image styling is via CSS class.
- **Same-document anchors.** `[text](#eq:foo)` is resolved by coflat
  against the in-doc label index. `LinkResolver` is not consulted for
  bare-fragment hrefs.

The principle: **if the data lives in this document, coflat resolves it.
If the data lives outside, the host resolves it through a narrow
interface.**

### What leaves coflat

The bibliography subsystem moves out. Today coflat ships citation-js +
CSL processor + locale + style files and reads `.bib` files via the
editor lifecycle. Under this design:

- citation-js / CSL processing is **not in the library**.
- `[@key]` and bare `@key` tokenize as before, but resolution and
  display go through `RefResolver`. If no resolver is supplied, the key
  renders as a degraded placeholder ("[knuth1984]") with no link.
- Hosts that want classic CSL-formatted citations import a separate
  helper that wraps citation-js and implements `RefResolver`. Cosheaf,
  which wants to mix bib entries with page-id refs and possibly user
  mentions, writes its own composite resolver.

Net effects:

- Library bundle shrinks substantially (citation-js + CSL is a large
  peer-dep chain today).
- `csl-processor.init-race.test.ts` becomes obsolete — the processor is
  no longer instantiated inside the editor lifecycle.
- The standalone editor product (the existing consumer) gains a small
  wiring step at startup: import the citeproc helper, pass its resolver
  into the editor's context. Two lines.

### What hosts compose behind `RefResolver`

The whole point of decoupling: one resolver, multiple sources, host
chooses precedence.

```ts
// Cosheaf's resolver (sketch):
const refResolver: RefResolver = {
  resolve(key, mode) {
    // 1. Workspace page index — [@cosheaf-id] is a page link.
    const page = workspace.pages.byId(key);
    if (page) {
      return {
        content: page.title,
        href: routes.page(page.id),
        className: "page-ref",
      };
    }
    // 2. Workspace bibliography (if loaded).
    const entry = workspace.bib?.byKey(key);
    if (entry) return citeproc.format(entry, mode);
    // 3. User directory — [@username] style.
    const user = workspace.users.byHandle(key);
    if (user) return { content: `@${user.name}`, href: routes.user(user.id) };
    // 4. Unknown.
    return null;
  },
};
```

The same source document `[@knuth1984]` displays as a citation in a
paper workspace and as a page link in a wiki workspace. Pandoc
canonicality is preserved — the source syntax doesn't change — and what
displays in the editor decouples from what Pandoc emits on export.

## Shared context across multiple instances

Today the editor models project context as CM6 facets
(`projectConfigFacet`, `projectConfigStatusFacet` in
`src/project-config.ts`). A facet is per-`EditorState`, so every editor
instance carries its own copy. With one editor on screen this is fine.
With N editors — one host editor plus K inline fragment editors, or a
side-by-side diff — it becomes:

- Wasteful: any resolver that does real work (a host page-index walk, a
  citeproc init in the host's optional citeproc helper) runs N times.
- Incoherent: an inline editor's `@eq:foo` cannot see the host page's
  labels because the inline editor's facet doesn't see them.
- Inconsistent with the reader: same source rendered as reader vs.
  edited would resolve refs against different scopes.

**One model for both surfaces.** Lift the heavy state out of
per-instance facets into a `DocumentContext` owned by the host, and
pass it as a constructor argument to both reader and editor.
Per-instance facets keep only what is genuinely per-instance (cursor,
undo history, view options).

```ts
// Built once per host page; reader and editor both accept it.
<Reader source={s} context={ctx} />
createEditor({ doc, context: ctx, ... })
```

Per-instance frontmatter still overrides for *that* instance only — an
inline editor declaring its own math macros shadows the host's. The
override is computed at parse time and never mutates the shared
context.

Concrete refactor:

- Keep `projectConfigFacet` for genuinely instance-local overrides
  (computed from this instance's frontmatter only).
- Add a new facet `documentContextFacet` holding a reference to the
  shared `DocumentContext`. Default to an empty context so standalone
  editor use keeps working with no call-site change.
- Move the bibliography subsystem out of the library entirely (see
  "What leaves coflat" above).
- Cross-ref resolution stays coflat-internal but is exposed through the
  context for sibling-instance reactivity: when an editor adds a new
  `{#eq:foo}` mid-typing, the in-doc label index bumps a version stamp
  that drives invalidation in subscribed reader/editor instances.

This unlocks the natural multi-instance UX: fragments render as reader
by default; click to edit swaps to an editor instance sharing the same
context. Link/ref semantics are identical across the swap.

Non-goals for this refactor: synchronizing *document text* across
instances (CRDT / OT territory — not on the table). The shared context
is read-mostly metadata, not document content.

## Public API

```ts
// Sibling export: @chaoxu/coflat-editor/reader

function renderToHtml(source: string, ctx?: DocumentContext): {
  html: string;
  hasMath: boolean;
};

// Companion text renderer. Shares the parser pass. For FTS snippets,
// notification subjects, email digests, terminal feeds.
function renderToText(source: string, ctx?: DocumentContext): {
  text: string;
  sourceToText?: Uint32Array;  // optional offset map for highlight spans
};

// React wrapper. Handles lazy KaTeX, caches by (sourceHash, ctxFingerprint).
function <Reader source={...} context={...} />;
```

```ts
// Sibling export: @chaoxu/coflat-editor/parse — Node-importable, no DOM.

function extractReferences(source: string): Array<{
  kind: "link" | "ref" | "image" | "crossref";
  raw: string;
  from: number;
  to: number;
  // shape-specific fields
  href?: string;        // link, image
  key?: string;         // ref, crossref
  mode?: "bracketed" | "narrative";  // ref
}>;
```

`extractReferences` is the canonical source for external indexers
(server-side, CLI, MCP). `renderToHtml` does not return refs/links — if
you want them, parse once with `extractReferences`. Both share the same
parser internals, so escapes and code-spans are honored consistently.

The core renderer is framework-agnostic (returns a string). The React
component is a thin wrapper. `DocumentContext` is exported from the
main entry; reader and editor consume the same type.

## Sanitization

dompurify is a peer dep. One config governs every place coflat injects
HTML: KaTeX output, `RefResolver.content`, code-block highlighting
output. The config is documented and exported so hosts can read (and at
the React-wrapper level, override) the policy. Trusted resolvers can
relax via wrapper props; the string-returning `renderToHtml` always
sanitizes.

## Fast path

Single regex scan of the source for "interesting" characters:
`` $ [ : ` # ^ < `` plus a leading `---`. If none present, the fragment
is plain inline markdown — bold, italic, code spans, links — and routes
to a ~5KB inline renderer. Expected hit rate on a typical
short-fragment stream: >70%.

Full parser only runs when the scan finds block-level or math/ref/cite
markers. This is the single biggest win at scale.

## KaTeX strategy

Render math as `<span data-math="…" data-display="0|1">…raw…</span>`
placeholders during string emit. On mount, the React wrapper checks
`hasMath`; if true and the wrapper is in the viewport
(IntersectionObserver), it `import()`s KaTeX once and rehydrates the
placeholders.

KaTeX bundle (~270KB gz) loads zero times on math-free hosts.

## What we reuse from the editor

Reusable as-is (pure, no CM6 dependency):

- `src/parser/`
- `src/lib/markdown/` (block-scanner, frontmatter, fenced-div,
  equation-label, footnote, label-parser, label-model)
- `src/semantics/`
- `src/references/model.ts`, `format.ts` (cross-ref resolution — stays
  internal)

Leaves the library:

- `src/citations/csl-processor.ts`, `bibtex-parser.ts`, `.csl` style
  files, locale XML, citation-js peer dep. These move into a separate,
  optional helper consumed via `RefResolver` by hosts that want classic
  citations.

Needs factoring (currently bound to CM `EditorState` / `Decoration`):

- The node→output walk. Editor emits decorations; reader needs HTML. A
  new `src/reader/render-html.ts` walks the same Lezer tree to strings.
- Cross-ref *presentation* (`src/references/presentation.ts`) is partly
  CM-bound; the reader needs a string-emitting twin.

The shape of the work: one new directory (`src/reader/`), one new facet
(`documentContextFacet`), removal of the citation subsystem from the
main package, and string-emitting twins for the CM-bound presentation
code. No breaking changes to the editor's public ref/link syntax.

## Packaging

Two options:

- **A. Sibling export in `@chaoxu/coflat-editor`.** New `"./reader"`
  entry, zero new package. Pulls in parser + semantics + dompurify.
  CM6 etc. stay out of the reader bundle via tree-shaking.
- **B. New package `@chaoxu/coflat-reader`.** Cleaner boundary, but
  duplicates the parser unless we extract a `@chaoxu/coflat-parser`
  base.

**Decision: start with A.** Revisit B only if the reader grows
substantial surface area or a consumer needs the reader without pulling
in the editor entry at all.

The optional citeproc helper ships as
`@chaoxu/coflat-editor/citeproc` (sibling export). One package to
publish, hosts opt in by importing. Revisit splitting only if it can't
tree-shake away when unused.

Public API discipline: the `exports` map is the contract. Sub-entries
committed for v1: `.` (editor), `./reader`, `./parse`, `./citeproc`,
`./test-utils`, `./style.css`. Everything else is private and may
change without notice. `publint` (already a devDep) is wired into CI as
part of Phase 0.

## Out of scope

- How fragments are stored, fetched, or addressed in the host.
- Server-side indexing or API design in the host.
- How the host builds its resolvers (composing bib + page index + user
  directory is host-side work).
- Synchronization of document text across instances.
- Parser extension by hosts (premise: parser is closed).

The library produces HTML from a string + context; the host owns
everything else.

## Plan

Phase 0: thread an external `DocumentContext` through a new
`documentContextFacet`. Define `LinkResolver`, `RefResolver`, extend
`FileSystem` with `resolveAssetUrl`. Move the citation subsystem out
into `@chaoxu/coflat-editor/citeproc`. Commit the `exports` map; wire
`publint` into CI. Default empty context keeps the existing standalone
product working when paired with the citeproc helper. No reader code
yet.

Phase 1: extract `@chaoxu/coflat-editor/parse` (Node-importable, no
DOM) with `extractReferences`. Write `src/reader/render-html.ts` and
`renderToText` for the inline subset, ship the fast path. No math, no
refs, no citations. Suitable for search snippets and notification
bodies — minimum surface to shake out the API.

Phase 2: add block-level support (lists, code, tables, fenced divs,
footnotes). Add KaTeX lazy hydration. Ship the theming contract:
semantic class names (`cf-equation`, `cf-citation`, …) on every emitted
element, plus a documented CSS custom-property set. Suitable for diff
and preview surfaces.

Phase 3: turn on `LinkResolver` and `RefResolver` end-to-end against
populated `DocumentContext`. Wire `FileSystem.resolveAssetUrl` for
images.

Phase 4: ship caching helpers (content-hash → HTML) as part of the
React wrapper, for hosts that render many fragments at once.

## Open questions

- Label index mutation propagation (coflat-internal): when an editor
  adds `{#eq:foo}` mid-typing, immediate vs. on-save propagation to
  sibling instances. Immediate is more coherent but creates a write
  path through the shared label index to design carefully. Decided
  during Phase 0 implementation.
- Async resolution and resolver reactivity (`version` / `subscribe`) —
  deferred to follow-up issues. v1 ships pure-synchronous resolvers
  with context fixed at mount.

Autocomplete suggestions previously listed here as a potential
`RefResolver.suggest(prefix)` method have been resolved: suggestions
live on a separate `AutocompleteSource` interface (issue #12), not on
the resolver. Read path (`resolve`) and write path (`suggest`) consume
the same host data but stay structurally separate. See
[`EDITOR-HOST-API.md`](./EDITOR-HOST-API.md).

## Out-of-scope but tracked elsewhere

The editor host API (save handler, image upload on paste, command and
keymap registry, intent emission for host-supplied pickers) is *not*
part of `DocumentContext`. `DocumentContext` covers shared,
document-wide, read-mostly state. Editor-specific seams live in
`EDITOR-HOST-API.md` (sibling design doc). Concrete designs for save,
upload, autocomplete, and intents are tracked in issues #10–#13.

## Release shape

Cut as `0.2.0`. No backwards compatibility shims; the old citation /
fileSystemFacet wiring is removed outright. Coflat (the predecessor
application) stays pinned to `0.1.14` indefinitely and is not migrated.
Cosheaf is the single consumer driving the new API.

Promote to `1.0.0` only after cosheaf has run on `0.2.x` for a real
period and the surface is stable.
