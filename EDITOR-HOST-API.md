# Editor host API

Sibling design note to `READER.md`. Covers editor-specific host seams
that are **not** part of `DocumentContext`.

`DocumentContext` (defined in READER.md) covers shared, document-wide,
read-mostly state: filesystem, link/ref resolvers, math macros. It is
the right surface for the reader and for read-only aspects of editor
instances. It is **not** the full editor host API.

This document tracks the additional seams an editor host needs. v1
status of each is noted; concrete designs land as separate issues when
a real consumer needs them.

## Status

The intent surface (`RequestHandler` + `StatusEvents`) is implemented
as of Phase 3.1 (issue #13). The other seams remain placeholders that
expand as a real consumer wants to customize them.

## Intent surface (implemented)

Editor mount options gain two optional fields:

```ts
import {
  mountEditor,
  type RequestHandler,
  type StatusEvents,
} from "@chaoxu/coflat-editor";

mountEditor({
  parent,
  requestHandler: { /* openLinkPicker, showUploadToast, openAutocomplete */ },
  statusEvents: { /* onSaveStart, onDirtyChange, ... */ },
});
```

`RequestHandler` is for request/response intents — the editor asks the
host for some UI (link picker, upload toast, autocomplete), the host
returns a `Promise<Result | null>` (where `null` means the user
cancelled). Every method is optional; missing methods fall through to
the library's **default chrome**, implemented in vanilla DOM under
`src/editor/default-chrome/`. The default chrome is intentionally
minimal — class hooks (`cf-default-picker`,
`cf-default-picker__input`, …) let hosts restyle without overriding.

`StatusEvents` is fire-and-forget. Hosts subscribe by providing any
subset of the callbacks; events for save/dirty (Phase 3.2) and asset
upload (Phase 3.3) plug into this surface. There's no return value;
the editor doesn't wait on the host.

Wired via two facets (`requestHandlerFacet`, `statusEventsFacet`)
defined in `src/editor-host-api.ts`. They sit alongside
`documentContextFacet`, not inside it: `DocumentContext` is shared,
read-mostly document state; host-API facets are per-instance
behavior.

Commands and keymaps are intentionally **not** part of this surface;
they'll land as a future `CommandRegistry` chunk.

## Seams

### Save / persistence

- The editor must not own where bytes go. Host supplies a save handler
  invoked on Ctrl+S, explicit save command, and (optionally) on
  autosave ticks.
- Host owns: storage location, conflict resolution, dirty-flag
  semantics, retry/backoff policy.
- Library owns: change events, change debouncing, "is this state
  saved?" boolean exposed to host.

v1: today's editor handles autosave internally via project-config; that
behavior moves behind a host-supplied `SaveHandler` interface.

### Asset upload (paste/drop images)

- When user pastes/drops an image, host decides where it lives and
  what its addressable path becomes. Editor inserts a placeholder,
  host returns a path or URL, editor rewrites to a real image
  reference.
- Host owns: upload destination, naming, mime restrictions, size caps.
- Library owns: paste/drop event handling, placeholder rendering,
  source rewrite on completion.

### Command and keymap registry

- Hosts add commands to the slash menu and command palette
  ("Insert page link," "Mention user," "Open issue picker") and remap
  keys.
- Library owns: built-in commands, default keymap, command-palette UI
  (until intents arrive, see below).
- Host owns: extension commands and any key remaps.

### Intents

- For UX flows where the editor needs *some* UI but the host wants its
  own design (link picker, mention autocomplete, image upload progress
  toast), the editor emits an intent and a host shell renders it.
- Default React shell renders the built-in UI in response to intents
  it knows about. Hosts that want custom UI swap the shell.
- Same pattern shadcn/Radix use for "headless components." Decouples
  behavior from chrome.

### Autocomplete sources

- When typing `[@`, `[](`, or `:` (emoji), the editor opens an
  autocomplete picker. Today the candidates are computed internally;
  hosts can't add sources.
- Host owns: candidate lists for `@`-references, link targets,
  emoji/snippet libraries.
- Library owns: trigger detection, picker UI (until intents),
  selection mechanics.
- Related to `RefResolver.suggest(prefix, mode)` in the deferred list
  on issue #1.

### Status surface

- The editor today exposes some status (project-config load state,
  parse errors) via its own UI. Hosts want to surface these in their
  own chrome.
- Library owns: emitting structured status events.
- Host owns: rendering them.

### Telemetry / logging

- Probably not a seam. Hosts can attach console / Sentry handlers to
  thrown errors; the library doesn't need a dedicated logger
  interface.

## Out of scope here

- Anything that lives in `DocumentContext`. That's READER.md territory.
- Document text synchronization across instances (CRDT / OT).
- Parser extension (parser is closed; see READER.md premises).

## Plan

This doc is intentionally a placeholder. The actual implementation
order is driven by which seam a real consumer needs first. Expected
order based on cosheaf signals:

1. Save handler (cosheaf's change/branch model needs to own writes).
2. Asset upload (cosheaf has Forgejo-backed storage; image paths matter).
3. Autocomplete sources (UX for `[@`-driven page/user/issue pickers).
4. Intents (when cosheaf wants its own link-picker chrome).
5. Command registry (when cosheaf adds non-trivial slash commands).
