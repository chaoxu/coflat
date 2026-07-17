# Editor Host API

The editor is headless with respect to application chrome. It owns FORMAT.md
editing behavior; the host owns storage, app routes, external pickers, upload
destinations, and surrounding UI.

`DocumentContext` is documented in `READER.md` and is shared by reader and
editor instances. This document covers editor-only host hooks.

## Public Surface

The root entry `@chaoxu/coflat` exports the implemented host-facing
interfaces:

- `RequestHandler`
- `StatusEvents`
- `SaveHandler`
- `AssetUploader`
- `AutocompleteSource`

These are provided through editor mount options. Missing hooks fall back to
built-in behavior where the editor has a reasonable default.

The root entry also exports the editing feature bundle (see "Editing
Features" below) and the `BibliographyStatus` type (see "Citations and
Bibliography"). CSL processing lives in the separate
`@chaoxu/coflat/citeproc` entry so citation-js stays out of the main
bundle.

```ts
import {
  mountEditor,
  type AutocompleteSource,
  type RequestHandler,
  type SaveHandler,
  type StatusEvents,
} from "@chaoxu/coflat";

mountEditor({
  parent,
  doc,
  requestHandler,
  statusEvents,
  saveHandler,
  autocompleteSources,
});
```

## Requests

`RequestHandler` is for request/response UI. The editor asks the host to open
or show something, and the host returns a result or `null` for cancellation.
Every method is optional.

Typical requests:

- Open a link picker.
- Show upload progress or failure.
- Open an autocomplete picker when the host wants to render its own picker.
- Open a bibliography file picker for the document-properties panel
  (`openBibliographyPicker`). When the host implements it, the panel's
  Bibliography field shows a "Browse…" button; otherwise it falls back to a
  plain text input.

Default chrome lives under `src/editor/default-chrome/` and is intentionally
small. Hosts that need product-specific UI should implement the request
instead of styling library-owned panels into application chrome.

## Status Events

`StatusEvents` is fire-and-forget. The editor emits lifecycle and state
changes; the host decides how to render them.

Typical events:

- Dirty state changed.
- Save started, completed, or failed.
- Asset upload started, completed, or failed.
- Parse or project-context status changed.

Status callbacks do not control editor behavior and should not be used as a
storage protocol.

## Document Changes

`onChange` receives the full source string for ordinary user edits and
remains supported. `onDocumentChange` receives the CodeMirror `ChangeSet`
and is the recommended alternative for hosts that can apply incremental
updates:

```ts
mountEditor({
  parent,
  doc,
  onChange(source) {
    cacheLatestSource(source);
  },
  onDocumentChange(change) {
    applyIncrementalChange(change.changes);
  },
});
```

The root editor API does not expose the live `EditorView` or per-change
snapshot helpers. Hosts that need a full snapshot outside `onChange` should
call `editor.getDoc()`.

## Save

`SaveHandler` gives persistence to the host.

The editor owns:

- Detecting document changes.
- Wiring save commands and keyboard shortcuts.
- Reporting dirty/save state.

The host owns:

- Storage location and authorization.
- Conflict handling.
- Retry policy.
- Whether autosave exists and how aggressive it is.

## Assets

`AssetUploader` handles pasted or dropped assets. The editor can detect the
asset event, insert a temporary source reference, and rewrite the document when
the upload completes. The host decides where bytes are stored and what path or
URL should be inserted.

The uploader should return the final addressable path. The file system in
`DocumentContext` can then resolve that path for previews and reader output.

## Autocomplete

`AutocompleteSource` lets hosts add candidates for references, links, snippets,
or other app-owned data. The library owns trigger detection and insertion
mechanics; the host owns the candidate list and any app-specific ranking.

Autocomplete is separate from `RefResolver`: resolving existing source and
suggesting new source are different operations, even when they read from the
same host data.

## Editing Features

The feature bundle is wired into the editor by default. The root entry
exports the pieces hosts configure, toggle, or expose in their own chrome.
Host-supplied `extensions` are appended after the built-in ones, so a facet
value provided there wins over the built-in default.

### Autocorrect

Autocorrect (text replacements plus magic quotes) is on by default.

- `autocorrectConfig` — facet taking `Partial<AutocorrectConfig>`; values
  merge over the defaults. Fields: `enabled`, `magicQuotes`, `quoteStyle`
  (a `QuoteStyle` locale key selecting the quote pairs), and `replacements`.
- `autocorrectCompartment` / `autocorrectExtension` — the built-in instance
  is wrapped in this compartment, so hosts can reconfigure or disable it at
  runtime:

```ts
view.dispatch({
  effects: autocorrectCompartment.reconfigure([
    autocorrectExtension(),
    autocorrectConfig.of({ magicQuotes: true, quoteStyle: "de-DE" }),
  ]),
});
```

### Formatting toolbar

`formattingToolbarExtension` (on by default) shows a floating toolbar of
inline-formatting buttons next to a non-empty selection.
`formattingToolbarCommands` exposes the same actions as palette commands.

### Rich clipboard and copy as HTML

`richPasteExtension` (on by default) converts pasted HTML to markdown and
binds paste-plain (Mod-Shift-v). `createRichPasteCommands()` returns the
clipboard commands (copy as markdown / copy as HTML / paste plain) for the
command registry.

"Copy as HTML" renders the selection through `htmlCopyRendererFacet`
(`(markdown) => string | Promise<string>`, last value wins). The editor
provides a default renderer that lazily loads the reader's `renderToHtml`;
hosts override it by providing the facet in `extensions`.

### Tables

`tableEditingKeymap` (on by default) drives pipe-table editing;
`tableEditingCommands` exposes table actions (insert/delete row and column,
alignment, and so on) as palette commands.

Edits inside a rendered table cell are ordinary main-history transactions on
the document: there is no separate commit boundary, undo/redo steps through
individual cell edits, and `onChange`/`onDocumentChange` fire per edit like
any other typing.

### Footnotes

`footnoteCommandsExtension` (on by default) provides footnote insertion
(Mod-Alt-f) and reference-aware Backspace behavior.
`footnotePaletteCommands` exposes the same actions as palette commands.

### Writing modes

`typewriterModeExtension` and `mutedLinesExtension` are wired but inactive
until toggled. `toggleTypewriterMode` and `toggleMutedLines` are commands
hosts can bind or call directly.

### List renumbering

`listRenumberExtension` (on by default) renumbers ordered lists after
structural edits.

## Citations and Bibliography

CSL processing is host-attached. The `@chaoxu/coflat/citeproc` entry
exports `parseBibTeX`, `CslProcessor`, `createCslCitationFormatter`, and the
`CitationFormatter` type; hosts build a formatter and attach it through
`DocumentContext` (`citationFormatter` plus `citationKeys`). See the
`citeproc.ts` entry docblock for the minimal example.

### CSL locale

`CslProcessor.create(items, cslXml, { locale, localeXml })` selects the CSL
locale used for rendering (default `"en-US"`). citation-js bundles `en-US`,
`nl-NL`, `fr-FR`, `de-DE`, and `es-ES`; any other locale needs its locale
XML supplied via `localeXml`.

### nocite

The frontmatter `nocite:` key adds bibliography entries without an in-text
citation, following Pandoc semantics including the `@*` wildcard. Resolved
entries are ordered after every in-text citation, so numeric styles number
them last. The editor and reader bibliography pipelines both apply it.

### BibliographyStatus

`BibliographyStatus` (exported from the root entry) reports bibliography
load state for hosts that surface diagnostics: `idle`, `ok`, `warning`, or
`error`. Failure states carry a `kind` (`read-bib`, `parse-bib`,
`detect-format`, `read-csl`, `style-csl`, or `unexpected`) and a `message`;
`ok` and `warning` carry `entryCount`, and parse warnings report
`skippedEntries` for recoverable per-entry skips. Load and parse failures of
the frontmatter `bibliography:`/`csl:` files surface here instead of being
swallowed — an unreadable or invalid CSL style degrades to a `warning` and
rendering falls back to the default style. Documents driven by a
`DocumentContext` formatter report a synthesized `ok` status.

## Boundary

Not part of the editor host API:

- Parser extension. FORMAT.md grammar changes happen in the library.
- Reader rendering contracts. See `READER.md`.
- Document text synchronization across multiple editor instances.
- App layout, panels, toolbars, or sidebars.

The editor should expose behavior and state, not render host-owned panels.
