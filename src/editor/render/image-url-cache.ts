import type { EditorView } from "@codemirror/view";
import type { FileSystem } from "../../core/lib/file-system-types";
import { readImageFileAsDataUrl } from "../lib/image-data-url";
import {
  type ImageUrlUpdate,
  imageUrlEffect,
  imageUrlField,
  imageUrlRemoveEffect,
} from "../state/image-url";
import { ERROR_COOLDOWN_MS } from "../state/pdf-preview";

export {
  type ImageUrlEntry,
  type ImageUrlStatus,
  type ImageUrlUpdate,
  imageUrlEffect,
  imageUrlField,
  imageUrlRemoveEffect,
} from "../state/image-url";

// Data URLs are the full base64 encoding of each image (often hundreds of KB
// each) and this map is module-level, so it must be bounded or a long-lived
// session that previews many images pins them all for the life of the page.
// Mirrors pdf-preview-cache's canvas cap (#486).
const MAX_DATA_URL_CACHE_SIZE = 64;

const dataUrlCache = new Map<string, string>();
const pendingPaths = new Map<string, number>();
const pathGenerations = new Map<string, number>();

export function getImageDataUrl(path: string): string | undefined {
  return dataUrlCache.get(path);
}

export function _resetImageUrlCache(): void {
  dataUrlCache.clear();
  pendingPaths.clear();
  pathGenerations.clear();
}

export function invalidateImageDataUrl(view: EditorView, path: string): void {
  const hadCache = dataUrlCache.delete(path);
  const hadEntry = view.state.field(imageUrlField).has(path);
  const hadPending = pendingPaths.has(path);

  if (!hadCache && !hadEntry && !hadPending) {
    return;
  }

  pathGenerations.set(path, (pathGenerations.get(path) ?? 0) + 1);

  if (hadEntry) {
    safeRemove(view, path);
  }
}

export async function requestImageDataUrl(
  view: EditorView,
  path: string,
  fs: FileSystem,
): Promise<void> {
  const existing = view.state.field(imageUrlField).get(path);
  const generation = pathGenerations.get(path) ?? 0;

  if (existing) {
    // Ready with cached data URL — nothing to do
    if (existing.status === "ready" && dataUrlCache.has(path)) return;

    // Error entries can be retried after cooldown
    if (existing.status === "error") {
      const elapsed = Date.now() - (existing.errorTime ?? 0);
      if (elapsed < ERROR_COOLDOWN_MS) return;
      // Cooldown expired — fall through to retry
    }

    // Loading — already in progress
    if (existing.status === "loading") return;
  }

  if (pendingPaths.get(path) === generation) return;
  pendingPaths.set(path, generation);

  // This runs synchronously inside imageRequestPlugin.update()/constructor,
  // where a direct view.dispatch() is a re-entrant update that throws (and was
  // being silently swallowed, so the loading state never showed). Defer it out
  // of the update cycle; the generation guard drops it if the request was
  // invalidated in the meantime.
  queueMicrotask(() => {
    if (isCurrentGeneration(path, generation)) {
      safeDispatch(view, { path, entry: { status: "loading" } });
    }
  });

  try {
    const dataUrl = await readImageFileAsDataUrl(path, fs);
    if (!isCurrentGeneration(path, generation)) return;
    if (!dataUrl) {
      safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
      return;
    }

    // Evict the oldest entry when full so the cache stays bounded; reset its
    // StateField entry so the next decoration pass re-requests on demand.
    if (dataUrlCache.size >= MAX_DATA_URL_CACHE_SIZE && !dataUrlCache.has(path)) {
      const oldest = dataUrlCache.keys().next().value;
      if (oldest !== undefined) {
        dataUrlCache.delete(oldest);
        safeRemove(view, oldest);
      }
    }
    dataUrlCache.set(path, dataUrl);
    safeDispatch(view, { path, entry: { status: "ready" } });
  } catch (_error) {
    if (!isCurrentGeneration(path, generation)) return;
    safeDispatch(view, { path, entry: { status: "error", errorTime: Date.now() } });
  } finally {
    if (pendingPaths.get(path) === generation) {
      pendingPaths.delete(path);
    }
  }
}

function safeDispatch(view: EditorView, update: ImageUrlUpdate): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: imageUrlEffect.of(update) });
  } catch (_error) {
    // View disconnected between guard and dispatch.
  }
}

function safeRemove(view: EditorView, path: string): void {
  if (!view.dom.isConnected) return;
  try {
    view.dispatch({ effects: imageUrlRemoveEffect.of(path) });
  } catch (_error) {
    // View disconnected between guard and dispatch.
  }
}

function isCurrentGeneration(path: string, generation: number): boolean {
  return pendingPaths.get(path) === generation && (pathGenerations.get(path) ?? 0) === generation;
}
