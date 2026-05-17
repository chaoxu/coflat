/**
 * Top-level entry for @chaoxu/coflat-editor/reader.
 *
 * The implementation lives in src/reader/reader.ts. This shim exists to keep
 * the Vite build entry stable and the package's `./reader` sub-path export
 * pointing at a top-level file.
 */
export {
  renderToHtml,
  renderToText,
  mapDomRangeToSource,
  hydrateMath,
  type HydrateMathOptions,
  type DocumentContext,
  type LinkResolver,
  type RefResolver,
} from "./src/reader/reader";
