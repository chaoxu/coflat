import { Decoration, type EditorView } from "@codemirror/view";
import { isSafeUrl } from "../../core/lib/url-utils";
import {
  linkSurfaceClassNames,
  renderedLinkDecorationAttributes,
} from "../../core/link-surface";
import { documentContextFacet } from "../document-context";
import { openExternalUrl } from "../lib/open-link";
import { documentPathFacet } from "../lib/types";

const maxLinkDecorationCacheSize = 256;
const linkDecorationCache = new Map<string, Decoration>();

export function getLinkDecoration(url: string): Decoration {
  const cached = linkDecorationCache.get(url);
  if (cached) {
    linkDecorationCache.delete(url);
    linkDecorationCache.set(url, cached);
    return cached;
  }

  const linkDeco = Decoration.mark({
    class: linkSurfaceClassNames(),
    attributes: renderedLinkDecorationAttributes(url),
  });
  linkDecorationCache.set(url, linkDeco);
  if (linkDecorationCache.size > maxLinkDecorationCacheSize) {
    const oldestUrl = linkDecorationCache.keys().next().value;
    if (oldestUrl !== undefined) {
      linkDecorationCache.delete(oldestUrl);
    }
  }
  return linkDeco;
}

/**
 * Returns null when no overrides apply so callers fall back to the
 * cached default decoration. `data-link-resolver="1"` signals the click
 * handler to re-consult the resolver for `onClick`.
 */
export function buildResolvedLinkDecoration(
  url: string,
  override: { className?: string; title?: string; hasOnClick?: boolean; force?: boolean } | null,
): Decoration | null {
  if (!override) return null;
  if (!override.className && !override.title && !override.hasOnClick && !override.force) {
    return null;
  }
  const cls = linkSurfaceClassNames(override.className);
  const attributes: Record<string, string> = {
    ...renderedLinkDecorationAttributes(url),
  };
  if (override.title) attributes.title = override.title;
  if (override.hasOnClick) attributes["data-link-resolver"] = "1";
  return Decoration.mark({ class: cls, attributes });
}

/**
 * Bare same-document anchors stay on coflat's internal anchor handling
 * and do not consult the host LinkResolver.
 */
export function isBareDocumentAnchor(href: string): boolean {
  return href.startsWith("#");
}

export function clearLinkDecorationCacheForTest(): void {
  linkDecorationCache.clear();
}

export function linkDecorationCacheSizeForTest(): number {
  return linkDecorationCache.size;
}

export function openRenderedLinkAtEvent(
  event: MouseEvent,
  view: EditorView,
): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const linkEl = target.closest("[data-url]");
  if (!linkEl) return false;
  const url = linkEl.getAttribute("data-url");
  if (!url || !isSafeUrl(url)) return false;

  // Host-supplied onClick takes precedence when the decoration was
  // produced with a resolver result. Re-resolve at click time so the
  // resolver does not need to be retained between render and click.
  if (linkEl.getAttribute("data-link-resolver") === "1") {
    const ctx = view.state.facet(documentContextFacet);
    const resolver = ctx?.linkResolver;
    if (resolver?.resolve && !isBareDocumentAnchor(url)) {
      const from = view.state.facet(documentPathFacet) || undefined;
      const text = linkEl.textContent ?? "";
      const result = resolver.resolve(url, text, { from });
      if (result?.onClick) {
        result.onClick(event);
        if (event.defaultPrevented) return true;
      }
    }
  }

  if (!(event.metaKey || event.ctrlKey)) return false;
  void openExternalUrl(url);
  event.preventDefault();
  return true;
}
