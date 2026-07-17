/**
 * Citation/CSL helper sub-entry. Imported as `@chaoxu/coflat/citeproc`.
 *
 * The main editor entry no longer ships citation-js / CSL processing in its
 * bundle. Hosts that want classic CSL-formatted citations import the symbols
 * below to parse `.bib` files, build a `CslProcessor`, and attach it to the
 * editor as a `CitationFormatter` through `DocumentContext`.
 *
 * Minimal example:
 *
 * ```ts
 * import { mountEditor } from "@chaoxu/coflat";
 * import {
 *   parseBibTeX,
 *   CslProcessor,
 *   createCslCitationFormatter,
 * } from "@chaoxu/coflat/citeproc";
 *
 * const items = parseBibTeX(await fetch("refs.bib").then((r) => r.text()));
 * const processor = await CslProcessor.create(items);
 * const formatter = createCslCitationFormatter(processor);
 * const editor = mountEditor({
 *   parent: el,
 *   context: {
 *     citationFormatter: formatter,
 *     citationKeys: new Set(items.map((item) => item.id)),
 *   },
 * });
 * ```
 */

import { buildReferenceCatalog } from "./parse";
import {
  type BibliographyFormat,
  parseBibliography,
} from "./src/core/citations/bibliography-parser";
import { parseBibTeX } from "./src/core/citations/bibtex-parser";
import { parseFrontmatter } from "./src/core/parser/frontmatter";
import type { CitationFormatter } from "./src/core/document-context-types";
import { collectCitedIdsFromClusters } from "./src/core/references/citation-rendering";
import { resolveNociteIds } from "./src/core/references/nocite";
import type { CitationCluster } from "./src/editor/citations/citation-matching";
import { collectCitationMatches } from "./src/editor/citations/citation-matching";
import { CslProcessor } from "./src/editor/citations/csl-processor";


export {
  type BibliographyFormat,
  type BibliographyParseOptions,
  type BibliographyParseResult,
  detectBibliographyFormat,
  parseBibliography,
} from "./src/core/citations/bibliography-parser";
export {
  type BibStore,
  type CslJsonItem,
  extractFirstFamilyName,
  extractYear,
  formatCslAuthors,
} from "./src/core/citations/csl-json";
export type { CitationFormatter } from "./src/core/document-context-types";
export type {
  CitationCluster,
  CitationCollectionOptions,
  CitationIdLookup,
  CitationReferenceCluster,
} from "./src/editor/citations/citation-matching";
export {
  type CitationJsLoader,
  type CitationJsModules,
  type CslBibliographyEntry,
  CslProcessor,
  type CslProcessorOptions,
  type CslStyleStatus,
  registerCitationsWithProcessor,
  setCitationJsLoaderForTest,
} from "./src/editor/citations/csl-processor";
// Bridge for hosts that want the editor's bibliography StateField. Hosts
// populate it with a CslProcessor they own, wrapped in a CitationFormatter.
export {
  type BibData,
  type BibliographyFailureKind,
  type BibliographyStatus,
  bibDataEffect,
  bibDataField,
} from "./src/editor/state/bib-data";
export { parseBibTeX };

export interface SourceCitationCollectionOptions {
  readonly isLocalTarget?: (id: string) => boolean;
}

export interface PreparedCitationFormatter {
  readonly formatter: CitationFormatter;
  readonly keys: ReadonlySet<string>;
  /**
   * Keys that will appear in the bibliography: in-text citations in document
   * order, then frontmatter `nocite:` keys.
   */
  readonly citedKeys: readonly string[];
  readonly clusters: readonly CitationCluster[];
}

export interface PrepareCitationFormatterOptions extends SourceCitationCollectionOptions {
  readonly source: string;
  readonly bibText: string;
  /** Explicit bibliography format; defaults to shape/extension detection. */
  readonly bibFormat?: BibliographyFormat;
  readonly cslXml?: string;
  /**
   * CSL locale code used for rendering, e.g. "en-US" or "de-DE". Defaults to
   * "en-US". citation-js bundles en-US, nl-NL, fr-FR, de-DE, and es-ES; any
   * other locale needs its XML supplied via `localeXml`.
   */
  readonly locale?: string;
  /** CSL locale XML registered for `locale` (host-supplied, not bundled). */
  readonly localeXml?: string;
}

export function collectCitationClustersFromSource(
  source: string,
  keys: ReadonlySet<string>,
  options: SourceCitationCollectionOptions = {},
): CitationCluster[] {
  const catalog = buildReferenceCatalog(source);
  return collectCitationMatches(catalog.references, keys, {
    isLocalTarget: (id) => catalog.uniqueTargetById.has(id) || Boolean(options.isLocalTarget?.(id)),
  });
}

export async function prepareCitationFormatterFromSource(
  options: PrepareCitationFormatterOptions,
): Promise<PreparedCitationFormatter | null> {
  const items = parseBibliography(options.bibText, { format: options.bibFormat }).items;
  if (items.length === 0) return null;
  const keys = new Set(items.map((item) => item.id));
  const catalog = buildReferenceCatalog(options.source);
  const isLocalTarget = (id: string): boolean =>
    catalog.uniqueTargetById.has(id) || Boolean(options.isLocalTarget?.(id));
  const clusters = collectCitationMatches(catalog.references, keys, { isLocalTarget });
  const citedKeys = collectCitedIdsFromClusters(clusters);
  // Frontmatter nocite keys register after every in-text citation so numeric
  // styles number them last, matching the editor/reader bibliography order.
  const nociteIds = resolveNociteIds(
    parseFrontmatter(options.source).config.nocite,
    keys,
    { isLocalTarget },
  ).filter((id) => !citedKeys.includes(id));
  if (citedKeys.length === 0 && nociteIds.length === 0) return null;
  const registered = nociteIds.length > 0
    ? [...clusters, { ids: nociteIds, locators: [] }]
    : clusters;
  const formatter = createCslCitationFormatter(
    await CslProcessor.create(items, options.cslXml, {
      locale: options.locale,
      localeXml: options.localeXml,
    }),
  );
  formatter.registerCitations(registered);
  return { formatter, keys, citedKeys: [...citedKeys, ...nociteIds], clusters };
}

/**
 * Wrap a `CslProcessor` so it satisfies the `CitationFormatter` contract
 * consumed by the main editor bundle. The processor is owned by the caller;
 * its lifetime is independent of the editor's.
 */
export function createCslCitationFormatter(processor: CslProcessor): CitationFormatter {
  return {
    cite: (ids, locators, extras) => processor.cite([...ids], [...locators], extras),
    citeNarrative: (id) => processor.citeNarrative(id),
    bibliographyEntries: (citedIds) => processor.bibliographyEntries(citedIds),
    registerCitations: (clusters) => processor.registerCitations(clusters),
    get citationRegistrationKey() {
      return processor.citationRegistrationKey;
    },
    get revision() {
      return processor.revision;
    },
  };
}
