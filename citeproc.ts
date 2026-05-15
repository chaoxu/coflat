/**
 * Citation/CSL helper sub-entry. Imported as `@chaoxu/coflat-editor/citeproc`.
 *
 * The main editor entry no longer ships citation-js / CSL processing in its
 * bundle. Hosts that want classic CSL-formatted citations import the symbols
 * below to parse `.bib` files and build a `RefResolver` that the editor's
 * `documentContextFacet` consumes.
 *
 * Public surface: just enough to (a) parse BibTeX into CSL-JSON, (b) format
 * a citation given a key + mode, (c) bridge into the existing internal bib
 * state for hosts still wiring the legacy bibliography render path during
 * the 0.2 transition.
 */

export {
  CslProcessor,
  registerCitationsWithProcessor,
  type CslBibliographyEntry,
  type CslStyleStatus,
  type CitationJsLoader,
  type CitationJsModules,
  setCitationJsLoaderForTest,
} from "./src/citations/csl-processor";

export {
  parseBibTeX,
} from "./src/citations/bibtex-parser";

export {
  type CslJsonItem,
  type BibStore,
  extractFirstFamilyName,
  extractYear,
  formatCslAuthors,
} from "./src/citations/csl-json";

// Bridge for hosts that still want the editor's internal bibliography
// StateField (will be removed in a follow-up once cosheaf migrates to a pure
// RefResolver). Lets a host populate the field with a CslProcessor it owns.
export {
  bibDataField,
  bibDataEffect,
  type BibData,
  type BibliographyStatus,
  type BibliographyFailureKind,
} from "./src/state/bib-data";
