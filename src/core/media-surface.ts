import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export type MediaKind = "image" | "pdf";
export type MediaWrapperTag = "span" | "div";

export function mediaLoadingLabel(kind: MediaKind, alt: string): string {
  const fallback = alt || "preview";
  return kind === "pdf"
    ? `[Loading PDF: ${fallback}]`
    : `[Loading image: ${fallback}]`;
}

export function imageUnavailableLabel(alt: string): string {
  return `[Image: ${alt || "preview"}]`;
}

export function mediaKindForSrc(src: string): MediaKind {
  return /\.pdf(?:[?#].*)?$/i.test(src) ? "pdf" : "image";
}

export function isUnresolvedLocalMediaUrl(src: string): boolean {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src);
}

export function createMediaWrapperElement(
  ownerDocument: Document,
  tagName: MediaWrapperTag,
): HTMLElement {
  const wrapper = ownerDocument.createElement(tagName);
  wrapper.className = CSS.imageWrapper;
  return wrapper;
}

export function createImageElement(
  ownerDocument: Document,
  src: string,
  alt: string,
): HTMLImageElement {
  const img = ownerDocument.createElement("img");
  img.className = CSS.image;
  img.src = src;
  img.alt = alt;
  return img;
}

export function syncInlineImageSize(
  wrapper: HTMLElement,
  img: HTMLImageElement,
): void {
  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return;
  }
  wrapper.style.width = `${img.naturalWidth}px`;
  wrapper.style.height = `${img.naturalHeight}px`;
  img.style.width = "100%";
  img.style.height = "100%";
}

export function syncInlineImageSizeOnLoad(
  wrapper: HTMLElement,
  img: HTMLImageElement,
): void {
  img.addEventListener("load", () => syncInlineImageSize(wrapper, img));
  if (img.complete) {
    syncInlineImageSize(wrapper, img);
  }
}

export function createImageSurfaceElement(
  ownerDocument: Document,
  tagName: MediaWrapperTag,
  src: string,
  alt: string,
): HTMLElement {
  const wrapper = createMediaWrapperElement(ownerDocument, tagName);
  wrapper.appendChild(createImageElement(ownerDocument, src, alt));
  return wrapper;
}

export function renderImageSurfaceHtml(
  src: string,
  alt: string,
  attrs = "",
): string {
  return (
    `<span class="${CSS.imageWrapper}"${attrs}>` +
    `<img class="${CSS.image}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` +
    `</span>`
  );
}

export function renderMediaLoadingHtml(
  src: string,
  alt: string,
  attrs = "",
): string {
  return (
    `<span class="${CSS.imageWrapper} ${CSS.imageLoading}"${attrs}>` +
    escapeHtml(mediaLoadingLabel(mediaKindForSrc(src), alt)) +
    `</span>`
  );
}

export function renderMediaLoadingInto(
  wrapper: HTMLElement,
  kind: MediaKind,
  alt: string,
): void {
  wrapper.className = `${CSS.imageWrapper} ${CSS.imageLoading}`;
  wrapper.textContent = mediaLoadingLabel(kind, alt);
}

export function renderImagePlaceholderInto(
  wrapper: HTMLElement,
  alt: string,
  options: { readonly block: boolean },
): void {
  wrapper.textContent = imageUnavailableLabel(alt);
  wrapper.className = options.block
    ? `${CSS.imageWrapper} ${CSS.imagePlaceholder}`
    : CSS.imageError;
}
