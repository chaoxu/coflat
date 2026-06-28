import { CSS } from "./constants/css-classes";
import { escapeHtml } from "./lib/html-escape";

export interface FootnoteSectionHtmlEntry {
  readonly num: number;
  readonly id: string;
  readonly html: string;
  readonly defFrom?: number;
  readonly backrefHref?: string;
}

export interface FootnoteSectionDomEntry {
  readonly num: number;
  readonly id: string;
  readonly defFrom?: number;
  readonly backrefHref?: string;
  readonly includeId?: boolean;
  readonly includeBackrefHref?: boolean;
  readonly appendContent: (content: HTMLSpanElement) => void;
}

export interface FootnoteSectionPlanInput {
  readonly num: number;
  readonly id: string;
  readonly defFrom?: number;
  readonly include?: boolean;
}

export interface FootnoteSectionPlanEntry {
  readonly num: number;
  readonly id: string;
  readonly defFrom?: number;
  readonly backrefHref?: string;
}

export interface FootnoteSectionOrderedEntryInput {
  readonly id: string;
  readonly number: number;
  readonly defFrom?: number;
  readonly include?: boolean;
}

export type FootnoteSectionProjectedEntry<TEntry extends FootnoteSectionOrderedEntryInput> =
  Omit<TEntry, "include"> & FootnoteSectionPlanEntry;

export function footnoteEntryId(id: string): string {
  return `fn-${encodeURIComponent(id)}`;
}

export function footnoteBackrefHref(id: string): string {
  return `#fnref-${encodeURIComponent(id)}`;
}

export function footnoteSectionPlan(
  entries: readonly FootnoteSectionPlanInput[],
  options: { readonly backrefs?: boolean } = {},
): readonly FootnoteSectionPlanEntry[] {
  const backrefs = options.backrefs ?? true;
  return entries
    .filter((entry) => entry.include !== false)
    .map((entry) => ({
      num: entry.num,
      id: entry.id,
      defFrom: entry.defFrom,
      backrefHref: backrefs ? footnoteBackrefHref(entry.id) : undefined,
    }));
}

export function footnoteSectionPlanFromOrderedEntries(
  entries: readonly FootnoteSectionOrderedEntryInput[],
  options: { readonly backrefs?: boolean } = {},
): readonly FootnoteSectionPlanEntry[] {
  return footnoteSectionPlan(
    entries.map((entry) => ({
      num: entry.number,
      id: entry.id,
      defFrom: entry.defFrom,
      include: entry.include,
    })),
    options,
  );
}

export function footnoteSectionPlanFromNumberedEntries<
  TEntry extends FootnoteSectionOrderedEntryInput,
>(
  entries: readonly TEntry[],
  options: { readonly backrefs?: boolean } = {},
): readonly FootnoteSectionProjectedEntry<TEntry>[] {
  const backrefs = options.backrefs ?? true;
  return entries
    .filter((entry) => entry.include !== false)
    .map((entry) => ({
      ...entry,
      num: entry.number,
      defFrom: entry.defFrom,
      backrefHref: backrefs ? footnoteBackrefHref(entry.id) : undefined,
    }));
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
      `<div id="${escapeHtml(footnoteEntryId(entry.id))}" class="${CSS.bibliographyEntry}"${defFromAttr}>` +
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

export function createFootnoteSectionElement(
  ownerDocument: Document,
  entries: readonly FootnoteSectionDomEntry[],
): HTMLDivElement {
  const section = ownerDocument.createElement("div");
  section.className = CSS.footnoteSection;
  section.setAttribute("aria-label", "Footnotes");

  const heading = ownerDocument.createElement("h2");
  heading.className = CSS.bibliographyHeading;
  heading.textContent = "Footnotes";
  section.appendChild(heading);

  const list = ownerDocument.createElement("div");
  list.className = CSS.bibliographyList;
  for (const entry of entries) {
    list.appendChild(createFootnoteEntryElement(ownerDocument, entry));
  }
  section.appendChild(list);

  return section;
}

export function createFootnoteEntryElement(
  ownerDocument: Document,
  entry: FootnoteSectionDomEntry,
): HTMLDivElement {
  const wrapper = ownerDocument.createElement("div");
  if (entry.includeId ?? true) {
    wrapper.id = footnoteEntryId(entry.id);
  }
  wrapper.className = CSS.bibliographyEntry;
  if (entry.defFrom !== undefined) {
    wrapper.dataset.defFrom = String(entry.defFrom);
  }

  const number = ownerDocument.createElement("sup");
  number.className = CSS.bibliographyEntryNumber;
  number.textContent = String(entry.num);
  wrapper.appendChild(number);

  const content = ownerDocument.createElement("span");
  entry.appendContent(content);
  wrapper.appendChild(content);

  if (entry.backrefHref) {
    wrapper.appendChild(ownerDocument.createTextNode(" "));
    const backref = ownerDocument.createElement("a");
    if (entry.includeBackrefHref ?? true) {
      backref.href = entry.backrefHref;
    }
    backref.className = CSS.footnoteBackref;
    backref.textContent = "↩";
    wrapper.appendChild(backref);
  }

  return wrapper;
}
