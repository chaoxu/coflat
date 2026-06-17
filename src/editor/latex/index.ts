// Re-export wrapper for .d.mts files which TypeScript doesn't auto-emit alongside .mjs
export type {
  ExportDependencyTool,
  ExportContract,
  LatexExportFlags,
  ResolvedLatexExportOptions,
  BuildLatexPandocArgsOptions,
} from "./export-options.mjs";

export {
  LATEX_CSL_NAMES,
  LATEX_PANDOC_FROM,
  LATEX_TEMPLATE_NAMES,
  EXPORT_CONTRACT,
  parseLatexFrontmatterConfig,
  resolveLatexExportOptions,
  resolveLatexCslPath,
  resolveLatexTemplatePath,
  latexBibliographyMetadataValue,
  buildLatexPandocArgs,
  buildPandocResourcePath,
  buildHtmlPandocArgs,
  exportDependencyTools,
} from "./export-options.mjs";

export { preprocessWithReadFile } from "./preprocess-core.mjs";
