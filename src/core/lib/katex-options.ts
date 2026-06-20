export const KATEX_TEXTSC_CLASS = "cf-katex-small-caps";

export const DEFAULT_KATEX_MACROS: Readonly<Record<string, string>> = Object.freeze({
  "\\textsc": `\\htmlClass{${KATEX_TEXTSC_CLASS}}{\\text{#1}}`,
});

interface KatexTrustContext {
  command: string;
  url?: string;
  class?: string;
}

export interface CoflatKatexOptions {
  displayMode: boolean;
  throwOnError: false;
  strict: (errorCode: string) => "ignore" | "warn";
  trust: (context: KatexTrustContext) => boolean;
  macros: Record<string, string>;
}

function normalizeKatexMacros(
  macros: Record<string, string> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = { ...DEFAULT_KATEX_MACROS };
  if (!macros) return normalized;

  for (const [key, value] of Object.entries(macros)) {
    if (!key.startsWith("\\")) continue;
    normalized[key] = value;
  }

  return normalized;
}

function trustKatexContext(context: KatexTrustContext): boolean {
  if (
    (context.command === "\\href" || context.command === "\\url") &&
    context.url != null &&
    /^https?:\/\//.test(context.url)
  ) {
    return true;
  }

  return context.command === "\\htmlClass" && context.class === KATEX_TEXTSC_CLASS;
}

/**
 * Build canonical KaTeX options for `katex.renderToString`.
 *
 * - `throwOnError: false` — render error boxes instead of throwing
 * - `trust` — allows `\href` / `\url` with `https?://` targets and only the
 *   built-in small-caps class used to emulate LaTeX `\textsc`
 * - Macros are spread to avoid KaTeX mutation of the caller's object
 */
export function buildKatexOptions(
  displayMode: boolean,
  macros?: Record<string, string>,
): CoflatKatexOptions {
  return {
    displayMode,
    throwOnError: false,
    strict: (errorCode) => errorCode === "htmlExtension" ? "ignore" : "warn",
    trust: trustKatexContext,
    macros: normalizeKatexMacros(macros),
  };
}
