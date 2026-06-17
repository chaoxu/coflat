import { CSS } from "./constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";
import { LINK_LAYOUT_ATTRIBUTE, linkLayoutForHref } from "./link-layout";

export interface LinkSurfaceOptions {
  readonly className?: string;
  readonly title?: string;
  readonly sourceAttrs?: string;
}

export function linkSurfaceClassNames(
  className?: string,
): string {
  const classNames: string[] = [
    DOCUMENT_SURFACE_CLASS.link,
    CSS.linkRendered,
  ];
  for (const token of className?.split(/\s+/) ?? []) {
    if (token !== "" && !classNames.includes(token)) {
      classNames.push(token);
    }
  }
  return documentSurfaceClassNames(...classNames);
}

export function linkSurfaceAttributes(
  href: string,
): Record<string, string> {
  return {
    [LINK_LAYOUT_ATTRIBUTE]: linkLayoutForHref(href),
  };
}

export function renderedLinkDecorationAttributes(
  href: string,
): Record<string, string> {
  return {
    "data-url": href,
    ...linkSurfaceAttributes(href),
  };
}

export function renderLinkSurfaceHtml(
  href: string,
  innerHtml: string,
  options: LinkSurfaceOptions = {},
): string {
  let attrs =
    ` class="${escapeHtml(linkSurfaceClassNames(options.className))}"` +
    ` href="${escapeHtml(href)}"` +
    ` ${LINK_LAYOUT_ATTRIBUTE}="${linkLayoutForHref(href)}"`;
  if (options.title) attrs += ` title="${escapeHtml(options.title)}"`;
  if (options.sourceAttrs) attrs += options.sourceAttrs;
  return `<a${attrs}>${innerHtml}</a>`;
}

export function applyLinkSurface(
  anchor: HTMLAnchorElement,
  href: string,
  options: LinkSurfaceOptions = {},
): void {
  anchor.className = linkSurfaceClassNames(options.className);
  anchor.href = href;
  anchor.setAttribute(LINK_LAYOUT_ATTRIBUTE, linkLayoutForHref(href));
  if (options.title) {
    anchor.title = options.title;
  } else {
    anchor.removeAttribute("title");
  }
}
