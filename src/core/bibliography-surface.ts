import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface BibliographySurfaceEntryHtml {
  readonly id: string;
  readonly html: string;
}

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
    `<div class="${CSS.bibliography}" aria-label="References">` +
    `<h2 class="${CSS.bibliographyHeading}">References</h2>` +
    `<div class="${CSS.bibliographyList}">${items.join("")}</div>` +
    `</div>`
  );
}

export function createBibliographySectionElement(
  ownerDocument: Document,
): HTMLDivElement {
  const section = ownerDocument.createElement("div");
  section.className = CSS.bibliography;
  section.setAttribute("aria-label", "References");

  const heading = ownerDocument.createElement("h2");
  heading.className = CSS.bibliographyHeading;
  heading.textContent = "References";
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
