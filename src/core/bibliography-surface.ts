import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface BibliographySurfaceEntryHtml {
  readonly id: string;
  readonly html: string;
}

export interface BibliographyBacklinkSurfaceEntry {
  readonly occurrence: number;
  readonly sourceFrom: number;
  readonly ariaLabel?: string;
}

export const BIBLIOGRAPHY_BACKLINK_TEXT = "↩";

export function bibliographyEntryId(id: string): string {
  return `bib-${encodeURIComponent(id)}`;
}

export function renderBibliographySectionHtml(
  entries: readonly BibliographySurfaceEntryHtml[],
): string {
  const items = entries.map((entry) =>
    `<div class="${CSS.bibliographyEntry}" id="${escapeHtml(bibliographyEntryId(entry.id))}">${entry.html}</div>`
  );
  return (
    `<div class="${CSS.bibliography}" aria-label="Bibliography">` +
    `<h2 class="${CSS.bibliographyHeading}">Bibliography</h2>` +
    `<div class="${CSS.bibliographyList}">${items.join("")}</div>` +
    `</div>`
  );
}

export function createBibliographySectionElement(
  ownerDocument: Document,
): HTMLDivElement {
  const section = ownerDocument.createElement("div");
  section.className = CSS.bibliography;
  section.setAttribute("aria-label", "Bibliography");

  const heading = ownerDocument.createElement("h2");
  heading.className = CSS.bibliographyHeading;
  heading.textContent = "Bibliography";
  section.appendChild(heading);

  section.appendChild(createBibliographyListElement(ownerDocument));
  return section;
}

export function createBibliographyListElement(
  ownerDocument: Document,
): HTMLDivElement {
  const list = ownerDocument.createElement("div");
  list.className = CSS.bibliographyList;
  return list;
}

export function bibliographyListElement(section: HTMLElement): HTMLDivElement {
  const list = section.querySelector<HTMLDivElement>(`:scope > .${CSS.bibliographyList}`);
  if (!list) {
    throw new Error("bibliography section helper did not render a list");
  }
  return list;
}

export function createBibliographyEntryElement(
  ownerDocument: Document,
  id: string,
): HTMLDivElement {
  const entry = ownerDocument.createElement("div");
  entry.className = CSS.bibliographyEntry;
  entry.id = bibliographyEntryId(id);
  return entry;
}

export function createBibliographyBacklinksElement(
  ownerDocument: Document,
  backlinks: readonly BibliographyBacklinkSurfaceEntry[],
): HTMLSpanElement | null {
  if (backlinks.length === 0) return null;

  const container = ownerDocument.createElement("span");
  container.className = CSS.bibliographyBacklinks;

  for (const backlink of backlinks) {
    if (container.childNodes.length > 0) {
      container.append(" ");
    }

    const link = ownerDocument.createElement("a");
    link.className = CSS.bibliographyBacklink;
    link.href = `#cite-ref-${backlink.occurrence}`;
    link.dataset.sourceFrom = String(backlink.sourceFrom);
    link.textContent = BIBLIOGRAPHY_BACKLINK_TEXT;
    link.setAttribute("aria-label", backlink.ariaLabel ?? "Jump to citation");
    container.appendChild(link);
  }

  return container;
}

export function appendBibliographyBacklinks(
  entryEl: HTMLElement,
  backlinks: readonly BibliographyBacklinkSurfaceEntry[],
): void {
  const backlinksEl = createBibliographyBacklinksElement(entryEl.ownerDocument, backlinks);
  if (!backlinksEl) return;
  entryEl.append(" ");
  entryEl.appendChild(backlinksEl);
}
