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

import { parseBibTeX } from "./src/core/citations/bibtex-parser";
import type { CitationFormatter } from "./src/core/document-context-types";
import { CslProcessor } from "./src/editor/citations/csl-processor";

export type { CitationFormatter } from "./src/core/document-context-types";
export { CslProcessor } from "./src/editor/citations/csl-processor";
export { parseBibTeX };

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
