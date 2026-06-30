import type { CitationFormatter } from "../document-context-types";
import { escapeHtml } from "../lib/html-escape";
import { type CslJsonItem, formatCslAuthors } from "./csl-json";

export interface NumericCitationEntry {
  readonly id: string;
  readonly author?: CslJsonItem["author"];
  readonly title?: string;
  readonly "container-title"?: string;
  readonly publisher?: string;
  readonly issued?: CslJsonItem["issued"];
}

const BIB_ENTRY_RE = /@([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
const SKIPPED_BIB_TYPES = new Set(["comment", "preamble", "string"]);

function normalizeEntries(
  entries: readonly string[] | readonly NumericCitationEntry[] = [],
): string[] {
  return entries.map((entry) => typeof entry === "string" ? entry : entry.id);
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function numericBibliographyEntryText(entry: NumericCitationEntry | undefined, fallbackId: string): string {
  if (!entry) return fallbackId;
  const year = entry.issued?.["date-parts"]?.[0]?.[0];
  const parts = [
    formatCslAuthors(entry.author),
    entry.title,
    entry["container-title"],
    entry.publisher,
    year == null ? undefined : String(year),
  ].map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  if (parts.length === 0) return fallbackId;
  const text = parts.reduce((joined, part) => {
    if (!joined) return part;
    return /[.!?]$/.test(joined) ? `${joined} ${part}` : `${joined}. ${part}`;
  }, "");
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * Parse BibTeX entry keys without loading citation-js.
 *
 * This is intentionally a key scanner, not a BibTeX validator. It recognizes
 * ordinary `@type{key, ...}` and `@type(key, ...)` entries and skips BibTeX
 * meta entries that do not define citeable records.
 */
export function parseBibliographyKeys(source: string): string[] {
  const keys: string[] = [];
  for (const match of source.matchAll(BIB_ENTRY_RE)) {
    const type = (match[1] ?? "").toLowerCase();
    const key = match[2] ?? "";
    if (!key || SKIPPED_BIB_TYPES.has(type)) continue;
    keys.push(key);
  }
  return unique(keys);
}

/**
 * Create a small numeric citation formatter for hosts that only need stable
 * `[1]` style labels and do not want to pull in the CSL/citation-js path.
 */
export function createNumericCitationFormatter(
  entries: readonly string[] | readonly NumericCitationEntry[] = [],
): CitationFormatter {
  const known = normalizeEntries(entries);
  const entryById = new Map<string, NumericCitationEntry>();
  for (const entry of entries) {
    if (typeof entry !== "string") entryById.set(entry.id, entry);
  }
  const labels = new Map<string, number>();
  known.forEach((id, index) => {
    if (id && !labels.has(id)) labels.set(id, index + 1);
  });
  let next = labels.size + 1;
  let citedIds: string[] = [];
  let registrationKey: string | null = null;
  let revision = 0;

  const labelFor = (id: string): number => {
    const existing = labels.get(id);
    if (existing !== undefined) return existing;
    labels.set(id, next);
    next += 1;
    return labels.get(id) ?? next - 1;
  };

  return {
    cite(ids, locators) {
      return `[${ids.map((id, index) => {
        const label = labelFor(id);
        const locator = locators[index];
        return locator ? `${label}, ${locator}` : String(label);
      }).join("; ")}]`;
    },

    citeNarrative(id) {
      return `[${labelFor(id)}]`;
    },

    bibliographyEntries(ids) {
      return unique([...ids, ...citedIds]).map((id) => ({
        id,
        html: `<span class="csl-left-margin">[${labelFor(id)}]</span> <span class="csl-right-inline">${escapeHtml(numericBibliographyEntryText(entryById.get(id), id))}</span>`,
      }));
    },

    registerCitations(clusters) {
      citedIds = unique(clusters.flatMap((cluster) => [...cluster.ids]));
      registrationKey = clusters
        .map((cluster) => cluster.ids.join(","))
        .join(";");
      revision += 1;
    },

    get citationRegistrationKey() {
      return registrationKey;
    },

    get revision() {
      return revision;
    },
  };
}
