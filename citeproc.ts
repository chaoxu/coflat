/**
 * Citation/CSL helper sub-entry. Imported as `@chaoxu/coflat/citeproc`.
 *
 * The main editor entry no longer ships citation-js / CSL processing in its
 * bundle. Hosts that want classic CSL-formatted citations import the symbols
 * below to parse `.bib` files, build a `CslProcessor`, and attach it to the
 * editor as a `CitationFormatter` via `documentContextFacet` or the
 * `bibDataEffect` state effect.
 *
 * Minimal example:
 *
 * ```ts
 * import { mountEditor } from "@chaoxu/coflat";
 * import {
 *   parseBibTeX,
 *   CslProcessor,
 *   createCslCitationFormatter,
 *   bibDataEffect,
 * } from "@chaoxu/coflat/citeproc";
 *
 * const items = parseBibTeX(await fetch("refs.bib").then((r) => r.text()));
 * const processor = await CslProcessor.create(items);
 * const editor = mountEditor({ parent: el });
 * editor.view.dispatch({
 *   effects: bibDataEffect.of({
 *     store: new Map(items.map((i) => [i.id, i])),
 *     formatter: createCslCitationFormatter(processor),
 *   }),
 * });
 * ```
 */

import type { CitationFormatter } from "./src/core/document-context-types";
import { parseBibTeX } from "./src/core/citations/bibtex-parser";
import { collectCitedIdsFromClusters } from "./src/core/references/citation-rendering";
import { CslProcessor } from "./src/editor/citations/csl-processor";
import type { CitationCluster } from "./src/editor/citations/citation-matching";
import { collectCitationMatches } from "./src/editor/citations/citation-matching";
import { buildReferenceCatalog } from "./parse";

export {
  CslProcessor,
  registerCitationsWithProcessor,
  type CslBibliographyEntry,
  type CslStyleStatus,
  type CitationJsLoader,
  type CitationJsModules,
  setCitationJsLoaderForTest,
} from "./src/editor/citations/csl-processor";

export { parseBibTeX };

export {
  type CslJsonItem,
  type BibStore,
  extractFirstFamilyName,
  extractYear,
  formatCslAuthors,
} from "./src/core/citations/csl-json";

// Bridge for hosts that want the editor's bibliography StateField. Hosts
// populate it with a CslProcessor they own, wrapped in a CitationFormatter.
export {
  bibDataField,
  bibDataEffect,
  type BibData,
  type BibliographyStatus,
  type BibliographyFailureKind,
} from "./src/editor/state/bib-data";

export type { CitationFormatter } from "./src/core/document-context-types";

export type {
  CitationCluster,
  CitationCollectionOptions,
  CitationIdLookup,
  CitationReferenceCluster,
} from "./src/editor/citations/citation-matching";

export interface SourceCitationCollectionOptions {
  readonly isLocalTarget?: (id: string) => boolean;
}

export interface PreparedCitationFormatter {
  readonly formatter: CitationFormatter;
  readonly keys: ReadonlySet<string>;
  readonly citedKeys: readonly string[];
  readonly clusters: readonly CitationCluster[];
}

export interface PrepareCitationFormatterOptions extends SourceCitationCollectionOptions {
  readonly source: string;
  readonly bibText: string;
  readonly cslXml?: string;
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
  const items = parseBibTeX(options.bibText);
  if (items.length === 0) return null;
  const keys = new Set(items.map((item) => item.id));
  const clusters = collectCitationClustersFromSource(options.source, keys, {
    isLocalTarget: options.isLocalTarget,
  });
  const citedKeys = collectCitedIdsFromClusters(clusters);
  if (citedKeys.length === 0) return null;
  const formatter = createCslCitationFormatter(await CslProcessor.create(items, options.cslXml));
  formatter.registerCitations(clusters);
  return { formatter, keys, citedKeys, clusters };
}

/**
 * Wrap a `CslProcessor` so it satisfies the `CitationFormatter` contract
 * consumed by the main editor bundle. The processor is owned by the caller;
 * its lifetime is independent of the editor's.
 */
export function createCslCitationFormatter(processor: CslProcessor): CitationFormatter {
  return {
    cite: (ids, locators) => processor.cite([...ids], [...locators]),
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
