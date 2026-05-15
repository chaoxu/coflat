/**
 * Editor host API — the intent surface.
 *
 * Phase 3.1 (issue #13) introduces two seams that hosts use to take
 * over editor-instance UI without replacing the editor itself:
 *
 *  - {@link RequestHandler}: request/response intents. The editor calls
 *    a method, the host returns a result (or `null` for user cancel).
 *    If the host doesn't supply a method, the editor falls through to
 *    library-default chrome (see `src/editor/default-chrome/`).
 *
 *  - {@link StatusEvents}: fire-and-forget lifecycle events. Save,
 *    dirty-state, asset-upload progress. The host listens; nothing
 *    waits on a return value.
 *
 * Commands and keymaps are intentionally out of scope here; they will
 * land in a future `CommandRegistry` chunk.
 *
 * The two interfaces are exposed as separate facets — `requestHandlerFacet`
 * and `statusEventsFacet` — so editor-instance behavior is decoupled
 * from the shared, read-mostly `DocumentContext` (see `document-context.ts`).
 *
 * Specific intents are wired by their respective chunks:
 *   3.2 — save lifecycle on `StatusEvents`
 *   3.3 — upload toast on `RequestHandler`, upload events on `StatusEvents`
 *   3.4 — autocomplete + link-picker sources on `RequestHandler`
 *
 * This chunk ships the link-picker intent end-to-end with a vanilla-DOM
 * default chrome so the surface is exercised.
 */

import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { defaultOpenLinkPicker } from "./editor/default-chrome/link-picker";

/* ────────────────────────────────────────────────────────────────────────────
 * RequestHandler
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Host-supplied UI for request/response intents the editor needs to
 * invoke (link pickers, upload toasts, autocomplete menus). Every
 * method is optional; the library falls back to default chrome when a
 * method is missing.
 *
 * Methods receive an `AbortSignal` and return `Promise<Result | null>`,
 * where `null` means the user cancelled.
 */
export interface RequestHandler {
  openLinkPicker?(req: LinkPickerRequest): Promise<LinkPickerResult | null>;
  /** Reserved for asset-upload chrome (Phase 3.3 may wire it). */
  showUploadToast?(req: UploadToastRequest): Promise<void>;
  /** Reserved for autocomplete (Phase 3.4 may wire it). */
  openAutocomplete?(req: AutocompleteRequest): Promise<AutocompleteResult | null>;
}

export interface LinkPickerRequest {
  trigger: "[" | "[](" | "[@";
  prefix: string;
  cursorPos: number;
  signal: AbortSignal;
  /** Sources to query — Phase 3.4 fills this in. */
  sources: readonly unknown[];
}

export interface LinkPickerResult {
  /** Text to splice at the trigger location. */
  insert: string;
}

export interface UploadToastRequest {
  placeholderId: string;
  file: File;
  /** 0..1, undefined if unknown. */
  progress?: number;
  signal: AbortSignal;
}

export interface AutocompleteRequest {
  trigger: string;
  prefix: string;
  cursorPos: number;
  signal: AbortSignal;
}

export interface AutocompleteResult {
  insert: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * StatusEvents
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Fire-and-forget lifecycle events. Hosts subscribe by supplying any
 * subset of the callbacks; missing callbacks are simply skipped.
 *
 * Specific events are emitted by future chunks — this chunk only
 * declares the surface and wires it through `statusEventsFacet`.
 */
export interface StatusEvents {
  /** Save lifecycle — Phase 3.2 fires these. */
  onSaveStart?(): void;
  onSaveSucceeded?(): void;
  onSaveFailed?(e: { error: string }): void;

  /** Dirty/saved tracking — Phase 3.2 fires these. */
  onDirtyChange?(dirty: boolean): void;

  /** Asset upload — Phase 3.3 fires these. */
  onAssetUploading?(e: { placeholderId: string; file: File; progress?: number }): void;
  onAssetUploadSucceeded?(e: { placeholderId: string; path: string }): void;
  onAssetUploadFailed?(e: { placeholderId: string; error: string }): void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Facets
 * ──────────────────────────────────────────────────────────────────────────── */

const EMPTY_REQUEST_HANDLER: RequestHandler = Object.freeze({});
const EMPTY_STATUS_EVENTS: StatusEvents = Object.freeze({});

/**
 * At-most-one host handler; last wins. Pattern matches
 * `fileSystemFacet` / `documentContextFacet`.
 */
export const requestHandlerFacet = Facet.define<RequestHandler, RequestHandler>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_REQUEST_HANDLER;
  },
});

/**
 * At-most-one status-events subscriber; last wins. Hosts that need
 * multiple subscribers can fan out in their callbacks.
 */
export const statusEventsFacet = Facet.define<StatusEvents, StatusEvents>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_STATUS_EVENTS;
  },
});

/* ────────────────────────────────────────────────────────────────────────────
 * Internal resolver helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Lookup the host's `openLinkPicker` for this view; if absent, fall
 * through to the library default. Importing the default lazily here
 * keeps the contract file free of DOM dependencies.
 */
export function resolveOpenLinkPicker(
  view: EditorView,
  req: LinkPickerRequest,
): Promise<LinkPickerResult | null> {
  const handler = view.state.facet(requestHandlerFacet);
  if (handler.openLinkPicker) {
    return handler.openLinkPicker(req);
  }
  return defaultOpenLinkPicker(view, req);
}

/** Fan-out a status event to the host's callback if present. */
export function emitStatusEvent<K extends keyof StatusEvents>(
  view: EditorView,
  key: K,
  ...args: Parameters<NonNullable<StatusEvents[K]>>
): void {
  const events = view.state.facet(statusEventsFacet);
  const fn = events[key] as ((...args: unknown[]) => void) | undefined;
  if (fn) {
    fn(...(args as unknown[]));
  }
}
