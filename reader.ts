/**
 * Top-level entry for @chaoxu/coflat/reader.
 *
 * The implementation lives in src/reader/reader.ts. This shim exists to keep
 * the Vite build entry stable and the package's `./reader` sub-path export
 * pointing at a top-level file.
 */
export {
  COFLAT_READER_CLASS,
  COFLAT_READER_DOCUMENT_CLASS,
  COFLAT_READER_SHELL_CLASS,
  COFLAT_READER_TOC_CLASS,
  COFLAT_THEME_SCOPE_CLASS,
  blueprintBookThemeManifest,
  renderToHtml,
  renderToText,
  mapDomRangeToSource,
  hydrateBlockDisclosures,
  hydrateReaderDisclosures,
  hydrateMath,
  hydrateReaderHoverPreviews,
  hydrateReferences,
  type HydrateMathOptions,
  type HydrateReferencesOptions,
  type ReaderHtmlResult,
  type ReaderOutlineEntry,
  type ReaderReferencePreviewEntry,
  type ReaderReferencePreviewIndex,
  type ReaderHoverPreviewEnv,
  type ReaderHoverPreviewOptions,
  type TruncatedInfo,
  type BlockCounterEntry,
  type ConditionalWriteResult,
  type DocumentContext,
  type FileEntry,
  type FileSystem,
  type LinkResolver,
  type RefResolver,
} from "./src/reader/reader";
export type { CoflatThemeManifest, CoflatThemeTarget } from "./src/core/theme-manifest";
