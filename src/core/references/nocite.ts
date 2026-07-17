// Pandoc `nocite:` resolution shared by the editor bibliography widget, the
// reader's References section, and the host-facing citeproc helpers — entries
// listed in the frontmatter appear in the bibliography without an in-text
// citation.
import type { CitationCollectionOptions } from "./citation-rendering";

/** Normalized form of the Pandoc `@*` wildcard (see frontmatter `nocite`). */
export const NOCITE_WILDCARD = "*";

/** Lookup over bibliography ids; satisfied by both `BibStore` and `Set`. */
export interface NociteKeyLookup {
  has(id: string): boolean;
  keys(): Iterable<string>;
}

/**
 * Resolve normalized `nocite` keys against the bibliography: keeps ids that
 * exist in the store and are not in-document crossref targets, expands the
 * wildcard to every store id (in store order), and de-duplicates.
 */
export function resolveNociteIds(
  nocite: readonly string[] | undefined,
  bibliography: NociteKeyLookup,
  options?: CitationCollectionOptions,
): string[] {
  if (!nocite || nocite.length === 0) return [];
  const resolved: string[] = [];
  const push = (id: string): void => {
    if (!bibliography.has(id) || options?.isLocalTarget?.(id)) return;
    if (!resolved.includes(id)) resolved.push(id);
  };
  for (const key of nocite) {
    if (key === NOCITE_WILDCARD) {
      for (const id of bibliography.keys()) push(id);
      continue;
    }
    push(key);
  }
  return resolved;
}
