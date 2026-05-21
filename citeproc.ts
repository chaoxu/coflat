/**
 * Citation/CSL helper sub-entry. Imported as `@chaoxu/coflat-editor/citeproc`.
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
 * import { mountEditor } from "@chaoxu/coflat-editor";
 * import {
 *   parseBibTeX,
 *   CslProcessor,
 *   createCslCitationFormatter,
 *   bibDataEffect,
 * } from "@chaoxu/coflat-editor/citeproc";
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
import { CslProcessor } from "./src/editor/citations/csl-processor";

export {
  CslProcessor,
  registerCitationsWithProcessor,
  type CslBibliographyEntry,
  type CslStyleStatus,
  type CitationJsLoader,
  type CitationJsModules,
  setCitationJsLoaderForTest,
} from "./src/editor/citations/csl-processor";

export {
  parseBibTeX,
} from "./src/core/citations/bibtex-parser";

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
