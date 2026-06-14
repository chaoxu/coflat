// Pure citation rendering shared by the reader, the editor, and external hosts.
// No DOM, no CodeMirror, no citation-js — it operates only on a host-supplied
// `CitationFormatter` (built from `@chaoxu/coflat/citeproc`) plus the set of
// known bibliography keys. This is the single source of truth for "is this a
// citation key", "what is its inline label", and "what is the bibliography",
// so each surface wires it instead of re-deriving the rules.
import type { CitationFormatter } from "../document-context-types";

export interface BibliographyEntryHtml {
  readonly id: string;
  /** Formatter-produced, host-sanitized-on-insertion HTML for one entry. */
  readonly html: string;
}

/** Whether `id` is a paper citation key (vs. an in-document crossref / host ref). */
export function isCitationKey(citationKeys: ReadonlySet<string> | undefined, id: string): boolean {
  return citationKeys?.has(id) ?? false;
}

/**
 * Inline label for a citation cluster, e.g. `[1]` or `[1, p. 4]`. Returns null
 * when the formatter is absent — callers fall through to other resolution.
 */
export function citeInline(
  formatter: CitationFormatter | undefined,
  ids: readonly string[],
  locators: readonly (string | undefined)[] = [],
): string | null {
  if (!formatter) return null;
  return formatter.cite(ids, locators);
}

/**
 * Bibliography entries for the cited keys, returned in `citedIds` order and
 * filtered to those keys. citeproc's `bibliographyEntries` ignores its id
 * argument and returns the FULL registered bibliography, so callers must pick
 * by `entry.id` — doing it here once prevents every host from regressing it
 * (e.g. taking `entries[0]` and previewing the wrong reference).
 */
export function bibliographyEntries(
  formatter: CitationFormatter | undefined,
  citedIds: readonly string[],
): BibliographyEntryHtml[] {
  if (!formatter || citedIds.length === 0) return [];
  const byId = new Map(formatter.bibliographyEntries(citedIds).map((entry) => [entry.id, entry]));
  const out: BibliographyEntryHtml[] = [];
  const seen = new Set<string>();
  for (const id of citedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = byId.get(id);
    if (entry) out.push({ id: entry.id, html: entry.html });
  }
  return out;
}

/** The single bibliography entry for one key, or null. Used for hover previews. */
export function bibliographyEntryFor(
  formatter: CitationFormatter | undefined,
  id: string,
): BibliographyEntryHtml | null {
  return bibliographyEntries(formatter, [id])[0] ?? null;
}
