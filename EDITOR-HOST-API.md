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

These are provided through editor mount options and CodeMirror facets. Missing
hooks fall back to built-in behavior where the editor has a reasonable default.

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

## Boundary

Not part of the editor host API:

- Parser extension. FORMAT.md grammar changes happen in the library.
- Reader rendering contracts. See `READER.md`.
- Document text synchronization across multiple editor instances.
- App layout, panels, toolbars, or sidebars.

The editor should expose behavior and state, not render host-owned panels.
