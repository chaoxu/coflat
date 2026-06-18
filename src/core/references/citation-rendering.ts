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

export interface CitationCluster {
  readonly ids: readonly string[];
  readonly locators?: readonly (string | undefined)[];
}

/** Shape of a reference with parallel id/locator arrays. */
export interface CitationReferenceCluster {
  readonly from?: number;
  readonly to?: number;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

/** Minimal interface for a store that can check whether a citation id exists. */
export interface CitationIdLookup {
  has(id: string): boolean;
}

export interface CitationCollectionOptions {
  readonly isLocalTarget?: (id: string) => boolean;
}

function serializeKeyPart(value: string | undefined): string {
  return value ?? "";
}

/** Whether `id` is a paper citation key (vs. an in-document crossref / host ref). */
export function isCitationKey(citationKeys: ReadonlySet<string> | undefined, id: string): boolean {
  return citationKeys?.has(id) ?? false;
}

export function isCitationId(
  id: string,
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): boolean {
  return store.has(id) && !options?.isLocalTarget?.(id);
}

export function getCitationRegistrationKey(
  clusters: readonly CitationCluster[],
): string {
  return clusters
    .map((cluster) => cluster.ids.map((id, index) =>
      `${id}\0${serializeKeyPart(cluster.locators?.[index])}`).join("\u0001"))
    .join("\u0002");
}

export function collectCitationMatches(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): CitationCluster[] {
  return references
    .filter((ref) => ref.ids.some((id) => isCitationId(id, store, options)))
    .map((ref) => {
      const ids: string[] = [];
      const locators: Array<string | undefined> = [];
      ref.ids.forEach((id, index) => {
        if (!isCitationId(id, store, options)) return;
        ids.push(id);
        locators.push(ref.locators[index]);
      });
      return { ids, locators };
    });
}

export function collectCitedIdsFromClusters(
  clusters: readonly CitationCluster[],
): string[] {
  const seen = new Set<string>();
  const citedIds: string[] = [];

  for (const cluster of clusters) {
    for (const id of cluster.ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      citedIds.push(id);
    }
  }

  return citedIds;
}

export function collectCitedIdsFromReferences(
  references: readonly CitationReferenceCluster[],
  store: CitationIdLookup,
  options?: CitationCollectionOptions,
): string[] {
  return collectCitedIdsFromClusters(collectCitationMatches(references, store, options));
}

export function appendCitedKeysFromReferenceIds(
  citedIds: string[],
  ids: readonly string[],
  citationKeys: ReadonlySet<string> | undefined,
  options?: CitationCollectionOptions,
): void {
  const store: CitationIdLookup = {
    has: (id) => isCitationKey(citationKeys, id),
  };
  for (const id of collectCitedIdsFromReferences([{ ids, locators: [] }], store, options)) {
    if (!citedIds.includes(id)) {
      citedIds.push(id);
    }
  }
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
