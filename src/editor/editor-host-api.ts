/**
 * Editor host API — the intent surface.
 *
 * Hosts use these seams to take over editor-instance UI and lifecycle
 * behavior without replacing the editor itself:
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
 * Commands and keymaps are intentionally out of scope here.
 *
 * The two interfaces are exposed as separate facets — `requestHandlerFacet`
 * and `statusEventsFacet` — so editor-instance behavior is decoupled
 * from the shared, read-mostly `DocumentContext` (see `document-context.ts`).
 *
 * Save, asset upload, autocomplete, and link-picker behavior all use
 * these facets.
 */

import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { defaultOpenAutocomplete } from "./default-chrome/autocomplete";
import { defaultOpenLinkPicker } from "./default-chrome/link-picker";

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
  showUploadToast?(req: UploadToastRequest): Promise<void>;
  openAutocomplete?(req: AutocompleteRequest): Promise<AutocompleteResult | null>;
}

export interface LinkPickerRequest {
  trigger: "[" | "[](" | "[@";
  prefix: string;
  cursorPos: number;
  signal: AbortSignal;
  /** Sources to query for this link/autocomplete request. */
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
  /** Sources whose trigger matched at this position. */
  sources: readonly AutocompleteSource[];
  /** Aggregated suggestions (already debounced + de-duplicated by id). */
  suggestions: readonly Suggestion[];
}

export interface AutocompleteResult {
  insert: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * AutocompleteSource
 * ──────────────────────────────────────────────────────────────────────────── */

export type SuggestionId = string;

/**
 * One picker row. `id` is the stable identity for re-render diffing.
 * `insert` is the exact text spliced into the doc when the user selects
 * the row; the editor replaces the trigger + prefix range with it.
 */
export interface Suggestion {
  id: SuggestionId;
  insert: string;
  display: string;
  description?: string;
  /** CSS class or emoji; renderer-agnostic. */
  icon?: string;
}

/**
 * Environment passed to {@link AutocompleteSource.suggest}. The
 * load-bearing field is {@code signal} — slow HTTP / cross-process
 * calls must be cancellable.
 */
export interface AutocompleteEnv {
  from?: string;
  cursorPos: number;
  signal: AbortSignal;
}

/**
 * A registered autocomplete source. The library:
 *   1. After each doc change, scans the text before the caret for known
 *      triggers (longest match wins).
 *   2. Cancels the previous in-flight `suggest()` via the shared
 *      AbortController.
 *   3. Debounces per source (default 80ms, override via
 *      {@link AutocompleteSource.debounceMs}).
 *   4. Calls `suggest(prefix, env)` with a fresh AbortSignal.
 *   5. Aggregates results from sources whose trigger matched.
 *
 * `trigger` is intentionally an open string — hosts can register any
 * prefix. Well-known values: "[@", "[](", "#", ":", "@".
 */
export interface AutocompleteSource {
  trigger: string;
  /** Per-source debounce; defaults to {@link DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS}. */
  debounceMs?: number;
  suggest(
    prefix: string,
    env: AutocompleteEnv,
  ): Promise<readonly Suggestion[]>;
}

export const DEFAULT_AUTOCOMPLETE_DEBOUNCE_MS = 80;

/* ────────────────────────────────────────────────────────────────────────────
 * StatusEvents
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Fire-and-forget lifecycle events. Hosts subscribe by supplying any
 * subset of the callbacks; missing callbacks are simply skipped.
 *
 */
export interface StatusEvents {
  /** Save lifecycle. */
  onSaveStart?(): void;
  onSaveSucceeded?(): void;
  onSaveFailed?(e: { error: string }): void;

  /** Dirty/saved tracking. */
  onDirtyChange?(dirty: boolean): void;

  /** Asset upload. */
  onAssetUploading?(e: { placeholderId: string; file: File; progress?: number }): void;
  onAssetUploadSucceeded?(e: { placeholderId: string; path: string }): void;
  onAssetUploadFailed?(e: { placeholderId: string; error: string }): void;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SaveHandler
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Host-supplied save persistence. The editor calls {@link SaveHandler.save}
 * on Ctrl+S, explicit {@code triggerSave} commands, and on autosave ticks.
 *
 * Dirty tracking is library-owned: the editor compares the live document
 * against the last successfully-saved source and fires
 * {@link StatusEvents.onDirtyChange} on transitions only.
 *
 * Autosave suppression is event-driven, not polled: the editor only
 * consults {@link SaveHandler.isBusy} at the moment an autosave is about
 * to fire. Hosts return {@code true} to defer the autosave until the next
 * doc change.
 *
 * The save payload is intentionally minimal — cursor / scroll / selection
 * are not save concerns.
 */
export interface SaveHandler {
  save(payload: {
    source: string;
    reason: "manual" | "command" | "autosave";
  }): Promise<{ ok: true } | { ok: false; error: string }>;

  /** Autosave debounce in ms. Defaults to {@link DEFAULT_AUTOSAVE_DEBOUNCE_MS}. */
  autosaveDebounceMs?: number;

  /**
   * If present and returns {@code true} at autosave-fire time, the editor
   * skips that autosave tick and waits for the next doc change.
   */
  isBusy?(): boolean;
}

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 1500;

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

/**
 * At-most-one save handler; last wins. The save extension reads from
 * this facet at dispatch time.
 */
export const saveHandlerFacet = Facet.define<SaveHandler, SaveHandler | null>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : null;
  },
});

/**
 * Aggregated list of {@link AutocompleteSource}s registered by the host.
 * Each `of(...)` contributes a full array; the combined output is the
 * flattened, registration-order list. The autocomplete controller reads
 * this facet at trigger-detection time.
 */
export const autocompleteSourcesFacet = Facet.define<
  readonly AutocompleteSource[],
  readonly AutocompleteSource[]
>({
  combine(values) {
    return values.flat();
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

/**
 * Lookup the host's `openAutocomplete` for this view; if absent, fall
 * through to the library default picker.
 */
export function resolveOpenAutocomplete(
  view: EditorView,
  req: AutocompleteRequest,
): Promise<AutocompleteResult | null> {
  const handler = view.state.facet(requestHandlerFacet);
  if (handler.openAutocomplete) {
    return handler.openAutocomplete(req);
  }
  return defaultOpenAutocomplete(view, req);
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
