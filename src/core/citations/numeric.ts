import type { CitationFormatter } from "../document-context-types";

export interface NumericCitationEntry {
  readonly id: string;
}

const BIB_ENTRY_RE = /@([A-Za-z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
const SKIPPED_BIB_TYPES = new Set(["comment", "preamble", "string"]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
        html: `<span class="csl-left-margin">[${labelFor(id)}]</span> <span class="csl-right-inline">${escapeHtml(id)}</span>`,
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
