/**
 * Barrel exports for the index module.
 *
 * Includes cross-reference resolution (T12) and the background AST
 * indexer with query API (T15).
 */

// Cross-reference resolver (T12)
export type {
  CrossrefKind,
  CrossrefMatch,
  EquationEntry,
  ResolvedCrossref,
} from "./crossref-resolver";
export {
  collectEquationLabels,
  findCrossrefs,
  resolveCrossref,
} from "./crossref-resolver";
export {
  extractFileIndex,
  type FileIndexAnalysisInput,
  removeFileFromIndex,
  updateFileInIndex,
} from "./extract";
export {
  BackgroundIndexer,
  type ChunkedBulkUpdateOptions,
  type DeferredUpdateFileOptions,
  type IndexFileSnapshot,
} from "./indexer";
// Background indexer query API (T15)
export {
  type DocumentIndex,
  type FileIndex,
  findReferences,
  getAllLabels,
  type IndexEntry,
  type IndexQuery,
  type IndexReference,
  type LabelResolution,
  queryIndex,
  querySourceText,
  type ResolvedReference,
  resolveLabel,
  resolveLabelResolution,
  resolveLabelTargets,
  type SourceTextQuery,
} from "./query-api";
