/**
 * Format-detecting bibliography ingestion.
 *
 * Internal storage is CSL-JSON, so CSL JSON and CSL YAML inputs are
 * parse-and-validate (per-item `id`/`type` guards, invalid entries skipped
 * and counted); `.bib` input delegates to the citation-js BibTeX parser.
 * Shared by the editor's bibliography load path and the host-facing
 * `@chaoxu/coflat/citeproc` entry.
 */

import { parse as parseYaml } from "yaml";
import { parseBibTeXResult } from "./bibtex-parser";
import type { CslJsonItem } from "./csl-json";

export type BibliographyFormat = "bibtex" | "csl-json" | "csl-yaml";

export interface BibliographyParseOptions {
  /** Explicit input format; skips extension/content detection. */
  readonly format?: BibliographyFormat;
  /** Source path; its extension (.bib/.json/.yaml/.yml) guides detection. */
  readonly path?: string;
}

export interface BibliographyParseResult {
  readonly items: CslJsonItem[];
  /** Format actually parsed; null when detection failed. */
  readonly format: BibliographyFormat | null;
  /** Entries dropped by per-item CSL validation (missing/invalid id or type). */
  readonly skippedEntries: number;
  /** Fatal parse or detection failure; `items` is empty when set. */
  readonly error?: string;
}

const FORMAT_BY_EXTENSION: ReadonlyMap<string, BibliographyFormat> = new Map([
  ["bib", "bibtex"],
  ["json", "csl-json"],
  ["yaml", "csl-yaml"],
  ["yml", "csl-yaml"],
]);

/**
 * Detect the bibliography format from a path extension, falling back to
 * content shape: a JSON array (`[`) is CSL JSON, an `@entry` start is BibTeX,
 * and a top-level `references:` key is Pandoc-style CSL YAML.
 */
export function detectBibliographyFormat(
  content: string,
  path?: string,
): BibliographyFormat | null {
  if (path) {
    const dot = path.lastIndexOf(".");
    const byExtension = dot >= 0
      ? FORMAT_BY_EXTENSION.get(path.slice(dot + 1).toLowerCase())
      : undefined;
    if (byExtension) return byExtension;
  }

  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("[")) return "csl-json";
  if (trimmed.startsWith("@")) return "bibtex";
  if (/^references\s*:/m.test(trimmed)) return "csl-yaml";
  return null;
}

function parseFailureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Per-item CSL guard: an object with a non-empty string/number id and string type. */
function toCslItem(raw: unknown): CslJsonItem | null {
  if (!isRecord(raw)) return null;
  const { id, type } = raw;
  if (typeof type !== "string" || type.length === 0) return null;
  if (typeof id === "string" && id.length > 0) return raw as CslJsonItem;
  if (typeof id === "number" && Number.isFinite(id)) {
    return { ...raw, id: String(id) } as CslJsonItem;
  }
  return null;
}

function validateCslItems(
  parsed: unknown,
  format: BibliographyFormat,
): BibliographyParseResult {
  if (!Array.isArray(parsed)) {
    return {
      items: [],
      format,
      skippedEntries: 0,
      error: "CSL data must be an array of items",
    };
  }
  const items: CslJsonItem[] = [];
  let skippedEntries = 0;
  for (const raw of parsed) {
    const item = toCslItem(raw);
    if (item) items.push(item);
    else skippedEntries += 1;
  }
  return { items, format, skippedEntries };
}

function parseCslJson(content: string): BibliographyParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    return {
      items: [],
      format: "csl-json",
      skippedEntries: 0,
      error: `Invalid CSL JSON: ${parseFailureMessage(error)}`,
    };
  }
  return validateCslItems(parsed, "csl-json");
}

function parseCslYaml(content: string): BibliographyParseResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error: unknown) {
    return {
      items: [],
      format: "csl-yaml",
      skippedEntries: 0,
      error: `Invalid CSL YAML: ${parseFailureMessage(error)}`,
    };
  }
  // Pandoc-style CSL YAML nests the item list under a `references:` key.
  const list = isRecord(parsed) && Array.isArray(parsed["references"])
    ? parsed["references"]
    : parsed;
  return validateCslItems(list, "csl-yaml");
}

function parseBibTexFormat(content: string): BibliographyParseResult {
  const result = parseBibTeXResult(content);
  return {
    items: result.items,
    format: "bibtex",
    skippedEntries: 0,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

/**
 * Parse bibliography content of any supported format into CSL-JSON items.
 *
 * Format comes from `options.format` when given, else from
 * {@link detectBibliographyFormat}. Undetectable content falls back to the
 * BibTeX parser (the historic default) and reports a detection failure only
 * when that also produces nothing.
 */
export function parseBibliography(
  content: string,
  options: BibliographyParseOptions = {},
): BibliographyParseResult {
  if (!content.trim()) {
    return { items: [], format: options.format ?? null, skippedEntries: 0 };
  }

  const format = options.format ?? detectBibliographyFormat(content, options.path);
  switch (format) {
    case "csl-json":
      return parseCslJson(content);
    case "csl-yaml":
      return parseCslYaml(content);
    case "bibtex":
      return parseBibTexFormat(content);
    default: {
      const fallback = parseBibTexFormat(content);
      if (!fallback.error && fallback.items.length > 0) return fallback;
      return {
        items: [],
        format: null,
        skippedEntries: 0,
        error: "Could not detect bibliography format (expected BibTeX, CSL JSON, or CSL YAML)",
      };
    }
  }
}
