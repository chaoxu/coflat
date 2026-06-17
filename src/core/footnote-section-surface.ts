import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface FootnoteSectionHtmlEntry {
  readonly num: number;
  readonly id: string;
  readonly html: string;
  readonly defFrom?: number;
  readonly backrefHref?: string;
}

export function renderFootnoteSectionHtml(entries: readonly FootnoteSectionHtmlEntry[]): string {
  if (entries.length === 0) return "";
  const items = entries.map((entry) => {
    const defFromAttr = entry.defFrom === undefined
      ? ""
      : ` data-def-from="${entry.defFrom}"`;
    const backref = entry.backrefHref
      ? ` <a href="${escapeHtml(entry.backrefHref)}" class="${CSS.footnoteBackref}">↩</a>`
      : "";
    return (
      `<div id="fn-${escapeHtml(encodeURIComponent(entry.id))}" class="${CSS.bibliographyEntry}"${defFromAttr}>` +
      `<sup class="${CSS.bibliographyEntryNumber}">${entry.num}</sup>` +
      `<span>${entry.html}</span>${backref}</div>`
    );
  });
  return (
    `<div class="${CSS.footnoteSection}" aria-label="Footnotes">` +
    `<h2 class="${CSS.bibliographyHeading}">Footnotes</h2>` +
    `<div class="${CSS.bibliographyList}">${items.join("")}</div>` +
    `</div>`
  );
}
