// Re-export wrapper for .d.mts files which TypeScript doesn't auto-emit alongside .mjs
export type {
  BuildLatexPandocArgsOptions,
  ExportContract,
  ExportDependencyTool,
  LatexExportDefaults,
  LatexExportFlags,
  ResolvedLatexExportOptions,
} from "./export-options.mjs";

export {
  buildHtmlPandocArgs,
  buildLatexPandocArgs,
  buildPandocResourcePath,
  EXPORT_CONTRACT,
  exportDependencyTools,
  LATEX_CSL_NAMES,
  LATEX_PANDOC_FROM,
  LATEX_TEMPLATE_NAMES,
  latexBibliographyMetadataValue,
  latexConfigWithDefaults,
  parseLatexFrontmatterConfig,
  resolveLatexCslPath,
  resolveLatexExportOptions,
  resolveLatexTemplatePath,
} from "./export-options.mjs";

export { preprocessWithReadFile } from "./preprocess-core.mjs";
