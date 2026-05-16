import type { CitationFormatter } from "../document-context";

/**
 * Extended citation-formatter interface consumed by the citeproc-side
 * bibliography render extension. Adds bibliography rendering and cluster
 * registration on top of the narrow main-bundle `CitationFormatter` shape.
 *
 * Hosts that build their own formatter implementation and want the
 * bibliography extension to render entries must satisfy this richer
 * interface. The `createCslCitationFormatter` helper in
 * `@chaoxu/coflat-editor/citeproc` returns a value that satisfies
 * `BibliographyFormatter` (and therefore also `CitationFormatter`).
 */
export interface BibliographyFormatter extends CitationFormatter {
  /**
   * Render the formatted bibliography entries for the cited ids. The returned
   * list is `id`-aligned but may be shorter (entries missing from the
   * formatter's bib are dropped).
   */
  bibliographyEntries(
    citedIds: readonly string[],
  ): readonly { readonly id: string; readonly html: string }[];
  /**
   * Tell the formatter about every cluster in the document so it can compute
   * numbering and disambiguation. Implementations should be idempotent when
   * called with the same set of clusters in the same order.
   */
  registerCitations(
    clusters: readonly {
      readonly ids: readonly string[];
      readonly locators?: readonly (string | undefined)[];
    }[],
  ): void;
  /**
   * Cache key for the most recent `registerCitations` call. Renderers use
   * this to skip redundant registration. May be `null` before any clusters
   * are registered.
   */
  readonly citationRegistrationKey: string | null;
}
