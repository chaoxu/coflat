/**
 * Hosts plug in an {@link AssetUploader} to handle paste/drop of files in
 * the editor. The library:
 *   1. Captures `paste` and `drop` events on the editor's content DOM.
 *   2. For each file, optionally consults {@link AssetUploader.accept};
 *      a rejection surfaces via {@link StatusEvents.onAssetUploadFailed}
 *      with a synthetic placeholderId and no document change.
 *   3. Inserts a placeholder image `![uploading…](upload:<id>)` at the
 *      cursor (paste) or drop coordinates (drop), one CM6 transaction
 *      per file.
 *   4. Fires {@link StatusEvents.onAssetUploading} immediately and
 *      (optionally) calls {@link RequestHandler.showUploadToast}.
 *   5. Awaits the upload promise. While it's in flight, every doc change
 *      is checked for placeholder survival; if the placeholder is gone,
 *      {@link AssetUploader.cancel} is called and the upload is dropped.
 *   6. On `{ path, alt? }` the placeholder is rewritten in-place to
 *      `![alt](path)` and {@code onAssetUploadSucceeded} fires.
 *      On `{ error }` the placeholder is rewritten to
 *      `![upload failed: <error>](upload-error:<id>)` and
 *      {@code onAssetUploadFailed} fires.
 *
 * The placeholder scheme `upload:` and the failure scheme `upload-error:`
 * are custom URL schemes; coflat's renderer leaves unknown schemes alone.
 */

import { type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

import {
  emitStatusEvent,
  type RequestHandler,
  requestHandlerFacet,
} from "./editor-host-api";
import { escapeMarkdownLabel, escapeMarkdownPath } from "./image-save";

/* ────────────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AssetUploader {
  upload(
    file: File,
    env: { from?: string },
  ): Promise<{ path: string; alt?: string } | { error: string }>;

  /** Pre-flight check. `null` means accept; `{ reject }` skips with reason. */
  accept?(file: File): null | { reject: string };

  /**
   * Called when the editor aborts an in-flight upload — either because
   * the placeholder was deleted from the document before resolve, or the
   * editor unmounted before resolve.
   */
  cancel?(file: File): void;
}

export type UploadedAssetMarkdownKind = "auto" | "image" | "link";

export interface UploadedAssetMarkdownInput {
  path: string;
  name?: string;
  mimeType?: string;
  alt?: string;
  kind?: UploadedAssetMarkdownKind;
}

const IMAGE_ASSET_EXTENSION_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?)$/i;

export function isUploadedAssetImage(
  asset: Pick<UploadedAssetMarkdownInput, "mimeType" | "name">,
): boolean {
  return Boolean(
    asset.mimeType?.startsWith("image/") ||
      (asset.name && IMAGE_ASSET_EXTENSION_RE.test(asset.name)),
  );
}

export function uploadedAssetLabel(name: string | undefined): string {
  const raw = name?.replace(/\.[^.]+$/, "").trim() || "asset";
  return escapeMarkdownLabel(raw) || "asset";
}

export function formatUploadedAssetMarkdown(
  asset: UploadedAssetMarkdownInput,
): string {
  const safePath = escapeMarkdownPath(asset.path);
  const label = Object.hasOwn(asset, "alt")
    ? escapeMarkdownLabel(asset.alt ?? "")
    : uploadedAssetLabel(asset.name);
  const kind =
    asset.kind && asset.kind !== "auto"
      ? asset.kind
      : isUploadedAssetImage(asset)
        ? "image"
        : "link";
  if (kind === "image") {
    return `![${label}](${safePath})`;
  }
  return `[${label || "asset"}](${safePath})`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Internals
 * ──────────────────────────────────────────────────────────────────────────── */

interface PendingUpload {
  placeholderId: string;
  file: File;
  from: number;
  to: number;
  cancelled: boolean;
  resolved: boolean;
  /** Aborts the host toast's signal once the upload settles or is cancelled. */
  controller?: AbortController;
}

interface PerViewState {
  uploader: AssetUploader;
  pending: Map<string, PendingUpload>;
  counter: number;
  destroyed: boolean;
}

const stateByView = new WeakMap<EditorView, PerViewState>();

function makePlaceholderId(s: PerViewState): string {
  // crypto.randomUUID is preferred when present; fall back to a counter
  // so jsdom and older environments still produce distinct IDs.
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  s.counter += 1;
  return `upload-${s.counter}`;
}

const PLACEHOLDER_ALT = "uploading…";

function placeholderMarkdown(id: string): string {
  return `![${PLACEHOLDER_ALT}](upload:${id})`;
}

function failureMarkdown(id: string, error: string): string {
  return `![upload failed: ${escapeMarkdownLabel(error)}](upload-error:${id})`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Per-file upload lifecycle
 * ──────────────────────────────────────────────────────────────────────────── */

function insertPlaceholder(
  view: EditorView,
  pos: number,
  id: string,
): { from: number; to: number } {
  const snippet = placeholderMarkdown(id);
  view.dispatch({
    changes: { from: pos, to: pos, insert: snippet },
    selection: { anchor: pos + snippet.length },
  });
  return { from: pos, to: pos + snippet.length };
}

function rewritePlaceholder(
  view: EditorView,
  pending: PendingUpload,
  replacement: string,
): boolean {
  const range = { from: pending.from, to: pending.to };
  if (view.state.doc.sliceString(range.from, range.to) !== placeholderMarkdown(pending.placeholderId)) return false;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: replacement },
  });
  return true;
}

async function runUpload(
  view: EditorView,
  s: PerViewState,
  pending: PendingUpload,
  env: { from?: string },
): Promise<void> {
  let result: { path: string; alt?: string } | { error: string };
  try {
    result = await s.uploader.upload(pending.file, env);
  } catch (e) {
    result = { error: e instanceof Error ? e.message : String(e) };
  }

  if (pending.cancelled) {
    // Already handled by the deletion watcher or unmount path.
    return;
  }
  pending.resolved = true;
  s.pending.delete(pending.placeholderId);
  pending.controller?.abort();

  if (s.destroyed) return;

  if ("error" in result) {
    const replacement = failureMarkdown(pending.placeholderId, result.error);
    rewritePlaceholder(view, pending, replacement);
    emitStatusEvent(view, "onAssetUploadFailed", {
      placeholderId: pending.placeholderId,
      error: result.error,
    });
    return;
  }

  const altRaw = result.alt ?? PLACEHOLDER_ALT;
  const alt = escapeMarkdownLabel(altRaw === PLACEHOLDER_ALT ? "" : altRaw);
  const replacement = formatUploadedAssetMarkdown({
    path: result.path,
    alt,
    kind: "image",
  });
  rewritePlaceholder(view, pending, replacement);
  emitStatusEvent(view, "onAssetUploadSucceeded", {
    placeholderId: pending.placeholderId,
    path: result.path,
  });
}

function startUpload(
  view: EditorView,
  s: PerViewState,
  file: File,
  pos: number,
  handler: RequestHandler,
): void {
  const accept = s.uploader.accept;
  if (accept) {
    const decision = accept(file);
    if (decision && "reject" in decision) {
      emitStatusEvent(view, "onAssetUploadFailed", {
        placeholderId: "<synthetic>",
        error: decision.reject,
      });
      return;
    }
  }

  const placeholderId = makePlaceholderId(s);
  const range = insertPlaceholder(view, pos, placeholderId);

  const pending: PendingUpload = {
    placeholderId,
    file,
    from: range.from,
    to: range.to,
    cancelled: false,
    resolved: false,
  };
  s.pending.set(placeholderId, pending);

  emitStatusEvent(view, "onAssetUploading", {
    placeholderId,
    file,
    progress: undefined,
  });

  // Optional host chrome — fire-and-forget.
  if (handler.showUploadToast) {
    const controller = new AbortController();
    pending.controller = controller;
    try {
      void handler.showUploadToast({
        placeholderId,
        file,
        signal: controller.signal,
      });
    } catch {
      // Host chrome is best-effort.
    }
  }

  void runUpload(view, s, pending, {});
}

function handleFiles(
  view: EditorView,
  s: PerViewState,
  files: ArrayLike<File>,
  startPos: number,
): boolean {
  if (!files || files.length === 0) return false;
  const handler = view.state.facet(requestHandlerFacet);
  // The first file inserts at the explicit position (cursor for paste,
  // mouse coords for drop). After each insertion the selection anchor
  // sits at the end of the just-inserted placeholder, so subsequent
  // files use the live cursor.
  const docLenBefore = view.state.doc.length;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    const pos =
      i === 0 ? startPos : view.state.selection.main.from;
    startUpload(view, s, file, pos, handler);
  }
  return view.state.doc.length !== docLenBefore;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Extension
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Create a CM6 extension that wires paste/drop to an {@link AssetUploader}.
 *
 * Designed to be ordered before `imagePasteExtension` / `imageDropExtension`
 * (or to replace them) when host upload is configured.
 */
export function assetUploaderExtension(uploader: AssetUploader): Extension {
  return [
    ViewPlugin.define((view) => {
      const s: PerViewState = {
        uploader,
        pending: new Map(),
        counter: 0,
        destroyed: false,
      };
      stateByView.set(view, s);
      return {
        update(update) {
          if (!update.docChanged) return;
          if (s.pending.size === 0) return;
          for (const pending of [...s.pending.values()]) {
            if (pending.resolved || pending.cancelled) continue;
            pending.from = update.changes.mapPos(pending.from, 1);
            pending.to = update.changes.mapPos(pending.to, -1);
            const current = update.state.doc.sliceString(pending.from, pending.to);
            if (current !== placeholderMarkdown(pending.placeholderId)) {
              pending.cancelled = true;
              s.pending.delete(pending.placeholderId);
              // controller.abort(), uploader.cancel and onAssetUploadFailed all
              // call into host code that may dispatch a transaction (abort fires
              // the toast signal's listeners synchronously); invoking them here
              // would be a re-entrant CM6 update. Defer out of the update cycle.
              const view = update.view;
              const { file, placeholderId, controller } = pending;
              queueMicrotask(() => {
                // Always abort the upload — the entry is already removed from
                // s.pending, so destroy()'s own cancel loop won't reach it, and
                // a synchronous destroy after this edit must not leak the
                // in-flight upload. Only the host event is skipped once torn
                // down (its UI is gone, and it must not run mid-teardown).
                controller?.abort();
                try {
                  uploader.cancel?.(file);
                } catch {
                  /* host cancel is best-effort */
                }
                if (s.destroyed) return;
                emitStatusEvent(view, "onAssetUploadFailed", {
                  placeholderId,
                  error: "cancelled",
                });
              });
            }
          }
        },
        destroy() {
          s.destroyed = true;
          for (const pending of s.pending.values()) {
            if (pending.resolved || pending.cancelled) continue;
            pending.cancelled = true;
            pending.controller?.abort();
            try {
              uploader.cancel?.(pending.file);
            } catch {
              /* host cancel is best-effort */
            }
          }
          s.pending.clear();
          stateByView.delete(view);
        },
      };
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const s = stateByView.get(view);
        if (!s) return false;
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;
        const files = clipboardData.files;
        if (!files || files.length === 0) return false;
        event.preventDefault();
        const pos = view.state.selection.main.from;
        handleFiles(view, s, files, pos);
        return true;
      },
      drop(event, view) {
        const s = stateByView.get(view);
        if (!s) return false;
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer || dataTransfer.files.length === 0) return false;
        event.preventDefault();
        let dropPos: number | null = null;
        try {
          dropPos = view.posAtCoords({
            x: event.clientX,
            y: event.clientY,
          });
        } catch {
          // posAtCoords requires layout; jsdom and headless environments
          // may throw. Fall through to the current selection.
        }
        const pos = dropPos ?? view.state.selection.main.from;
        handleFiles(view, s, dataTransfer.files, pos);
        return true;
      },
      dragover(event) {
        if (event.dataTransfer?.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          return true;
        }
        return false;
      },
    }),
  ];
}
