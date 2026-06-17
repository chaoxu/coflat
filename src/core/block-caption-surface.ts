import {
  appendBlockLabel,
  renderBlockLabelHtml,
} from "./block-heading-surface";
import { CSS } from "./constants/css-classes";

export function blockCaptionClassName(active = false): string {
  return active
    ? `cf-block-caption ${CSS.activeShellWidget} ${CSS.activeShellFooter}`
    : "cf-block-caption";
}

export function renderBlockCaptionHtml(
  label: string,
  titleHtml: string,
  attrs = "",
): string {
  return (
    `<div class="${blockCaptionClassName()}"${attrs}>` +
    renderBlockLabelHtml(label) +
    `<span class="cf-block-caption-text">${titleHtml}</span>` +
    `</div>`
  );
}

export function createBlockCaptionElement(
  ownerDocument: Document,
  active = false,
): HTMLDivElement {
  const caption = ownerDocument.createElement("div");
  caption.className = blockCaptionClassName(active);
  return caption;
}

export function appendBlockCaptionLabel(
  caption: HTMLElement,
  label: string,
): HTMLSpanElement {
  return appendBlockLabel(caption, label);
}

export function appendBlockCaptionText(
  caption: HTMLElement,
): HTMLSpanElement {
  const titleEl = caption.ownerDocument.createElement("span");
  titleEl.className = "cf-block-caption-text";
  caption.appendChild(titleEl);
  return titleEl;
}
