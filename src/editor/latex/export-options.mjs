import { parse as parseYaml } from "yaml";
import { isFrontmatterDelimiterLine } from "../lib/frontmatter-delimiter.js";
import exportContract from "./export-contract.json" with { type: "json" };

export const EXPORT_CONTRACT = exportContract;
// LaTeX export disables pandoc's `latex_macros` extension (on by default for
// the markdown reader). With it on, pandoc expands every author macro inline in
// the body (`\set{1,2}` -> `\left\{1,2\right\}`) while still emitting the
// `\newcommand` into the preamble — redundant, and harder to read or edit. With
// it off, the body keeps `\macro{}` calls verbatim and the preamble
// `\newcommand`s (from `renderMathMacros`) do the expansion at compile time, the
// way a hand-written LaTeX paper would. The HTML path keeps `latex_macros` on so
// KaTeX receives fully expanded math. Must match the contract's LaTeX `--from`.
export const LATEX_PANDOC_FROM = `${exportContract.pandoc_from}-latex_macros`;

export const LATEX_TEMPLATE_NAMES = new Set(
  Object.keys(exportContract.latex.templates.builtins),
);
export const LATEX_CSL_NAMES = new Set(
  Object.keys(exportContract.latex.csl.builtins),
);

export function parseLatexFrontmatterConfig(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) {
    return {};
  }
  const closeIndex = lines.findIndex((line, index) => index > 0 && isFrontmatterDelimiterLine(line));
  if (closeIndex < 0) {
    return {};
  }
  let parsed;
  try {
    parsed = parseYaml(lines.slice(1, closeIndex).join("\n"));
  } catch (_error) {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const config = {};
  if (typeof parsed.bibliography === "string") {
    config.bibliography = parsed.bibliography;
  }
  if (typeof parsed.csl === "string") {
    config.csl = parsed.csl;
  }
  if (parsed.latex && typeof parsed.latex === "object" && !Array.isArray(parsed.latex)) {
    const latex = {};
    if (typeof parsed.latex.template === "string") {
      latex.template = parsed.latex.template;
    }
    if (typeof parsed.latex.bibliography === "string") {
      latex.bibliography = parsed.latex.bibliography;
    }
    if (typeof parsed.latex.csl === "string") {
      latex.csl = parsed.latex.csl;
    }
    if (Object.keys(latex).length > 0) {
      config.latex = latex;
    }
  }
  return config;
}

export function resolveLatexExportOptions({ config = {}, flags = {} } = {}) {
  const latex = config.latex && typeof config.latex === "object" ? config.latex : {};
  return {
    bibliography:
      stringOption(flags.bibliography) ??
      stringOption(latex.bibliography) ??
      stringOption(config.bibliography),
    csl:
      stringOption(flags.csl) ??
      stringOption(latex.csl) ??
      stringOption(config.csl) ??
      exportContract.latex.csl.default,
    template:
      stringOption(flags.template) ??
      stringOption(latex.template) ??
      exportContract.latex.templates.default,
  };
}

export function latexConfigWithDefaults(config = {}, defaults = {}) {
  const latex = config.latex && typeof config.latex === "object" ? config.latex : {};
  return {
    ...config,
    bibliography: stringOption(config.bibliography) || stringOption(latex.bibliography)
      ? config.bibliography
      : defaults.bibliography,
    csl: stringOption(config.csl) || stringOption(latex.csl) ? config.csl : defaults.csl,
    latex: {
      ...latex,
      ...(!stringOption(latex.template) && defaults.template ? { template: defaults.template } : {}),
    },
  };
}

function stringOption(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isAbsolutePath(path) {
  return /^(?:\/|[A-Za-z]:[\\/])/.test(path);
}

function defaultResolvePath(base, path) {
  if (isAbsolutePath(path)) {
    return path;
  }
  return [base, path].filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function resolveLatexTemplatePath(template, { cwd = "", latexDir, pathResolve = defaultResolvePath } = {}) {
  const name = template || exportContract.latex.templates.default;
  const builtinTemplate = exportContract.latex.templates.builtins[name];
  if (builtinTemplate) {
    return pathResolve(latexDir, builtinTemplate);
  }
  return pathResolve(cwd, name);
}

export function resolveLatexCslPath(csl, { cwd = "", latexDir, pathResolve = defaultResolvePath } = {}) {
  const name = csl || exportContract.latex.csl.default;
  const builtinCsl = exportContract.latex.csl.builtins[name];
  if (builtinCsl) {
    return pathResolve(latexDir, builtinCsl);
  }
  return pathResolve(cwd, name);
}

export function latexBibliographyMetadataValue(bibliography) {
  if (!bibliography) {
    return null;
  }
  return bibliography;
}

export function buildLatexPandocArgs({
  bibliography,
  cslPath,
  filterPath,
  format = "latex",
  output,
  resourcePath,
  template,
}) {
  const values = {
    latex_csl_path: cslPath ?? resolveLatexCslPath(undefined, { latexDir: dirname(filterPath) }),
    latex_filter_path: filterPath,
    latex_template_path: template,
    output_path: output,
    pandoc_from: exportContract.pandoc_from,
    resource_path: resourcePath,
  };
  const args = renderArgs(exportContract.latex.args, values).filter(
    (arg) => resourcePath || !arg.startsWith("--resource-path="),
  );
  const bibliographyMetadata = latexBibliographyMetadataValue(bibliography);
  if (bibliographyMetadata) {
    args.push(renderArg(exportContract.latex.bibliography_metadata_arg, {
      bibliography_metadata: bibliographyMetadata,
    }));
  }
  if (format === "pdf") {
    args.push(...exportContract.latex.pdf_args);
  }
  return args;
}

export function buildPandocResourcePath(projectRoot, sourceDir, { delimiter = ":" } = {}) {
  const pathByEntry = {
    project_root: projectRoot,
    source_dir: sourceDir,
  };
  const paths = [];
  for (const entry of exportContract.resource_path.entries) {
    const path = pathByEntry[entry];
    if (!path) {
      continue;
    }
    if (exportContract.resource_path.dedupe && paths.includes(path)) {
      continue;
    }
    paths.push(path);
  }
  return paths.join(delimiter);
}

export function buildHtmlPandocArgs({ output, resourcePath }) {
  return renderArgs(exportContract.html.args, {
    output_path: output,
    pandoc_from: exportContract.pandoc_from,
    resource_path: resourcePath,
  });
}

export function exportDependencyTools(format) {
  return exportContract.dependencies[format] ?? [];
}

function renderArgs(args, values) {
  return args.map((arg) => renderArg(arg, values));
}

function renderArg(arg, values) {
  return arg.replaceAll(/\{([a-z_]+)\}/g, (_match, key) => values[key] ?? "");
}

function dirname(path) {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
}
