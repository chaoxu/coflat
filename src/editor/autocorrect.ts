/**
 * Autocorrect and magic quotes for the CM6 editor.
 *
 * Ported from Zettlr's `commands/autocorrect.ts` and
 * `statusbar/magic-quotes.ts`:
 *
 * - Space/Enter-triggered text replacements from a configurable table
 *   (em/en dashes, ellipsis, arrows, math symbols, ...). Each replacement is
 *   dispatched as its own transaction annotated with `isolateHistory.of
 *   ("full")` so a single Undo reverts only the replacement while keeping
 *   the typed space or newline.
 * - Magic quotes: the `"` and `'` keys insert locale-aware typographic
 *   quote pairs, choosing the opening or closing character based on the
 *   character preceding the cursor. A non-empty selection is surrounded by
 *   the pair.
 * - Backspace immediately after a magic quote downgrades it to the straight
 *   character instead of deleting it.
 * - Everything is suppressed inside protected ranges: inline/fenced code,
 *   math, comments, HTML blocks, horizontal rules (syntax-tree exclusion,
 *   same node types as spellcheck.ts), and YAML frontmatter (tracked by
 *   `frontmatterField`, since Coflat's parser has no frontmatter node).
 *
 * Intended wiring: append `autocorrectExtension()` (optionally with a
 * config) to the editor extension list. The extension is self-contained —
 * it bundles a `Prec.high` keymap for Space/Enter/Backspace/`"`/`'` plus
 * the `frontmatterField` dependency (CM6 deduplicates the field when the
 * host already provides it). Append it AFTER `listOutlinerExtension` so the
 * outliner's `Prec.highest` Enter/Backspace handlers keep priority; the
 * autocorrect Enter handler mirrors the default Enter chain
 * (`insertNewlineContinueMarkup` → `insertNewlineAndIndent`) so behavior
 * stays consistent when it wins.
 */

import { insertNewlineAndIndent, isolateHistory } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  Prec,
} from "@codemirror/state";
import { type Command, type EditorView, keymap } from "@codemirror/view";
import { findAncestor } from "./lib/syntax-tree-helpers";
import { NO_SPELLCHECK_TYPES } from "./spellcheck";
import { frontmatterField } from "./state/frontmatter-state";

// ---------------------------------------------------------------------------
// Quote pair table (per locale)
// ---------------------------------------------------------------------------

/** An opening/closing typographic quote pair. */
export interface QuotePair {
  readonly open: string;
  readonly close: string;
}

/** Primary (double) and secondary (single) quote pairs for one locale. */
export interface MagicQuotePairs {
  readonly primary: QuotePair;
  readonly secondary: QuotePair;
}

/**
 * Magic-quote pairs per locale. Subset of Zettlr's table (which follows
 * https://de.wikipedia.org/wiki/Anf%C3%BChrungszeichen). The French pairs
 * include the space inside the guillemets, matching Zettlr.
 */
export const MAGIC_QUOTES_PAIRS = {
  "en-US": {
    primary: { open: "“", close: "”" },
    secondary: { open: "‘", close: "’" },
  },
  "en-GB": {
    primary: { open: "‘", close: "’" },
    secondary: { open: "“", close: "”" },
  },
  "de-DE": {
    primary: { open: "„", close: "“" },
    secondary: { open: "‚", close: "‘" },
  },
  "de-CH": {
    primary: { open: "«", close: "»" },
    secondary: { open: "‹", close: "›" },
  },
  "fr-FR": {
    primary: { open: "« ", close: " »" },
    secondary: { open: "‹ ", close: " ›" },
  },
  es: {
    primary: { open: "«", close: "»" },
    secondary: { open: "“", close: "”" },
  },
  it: {
    primary: { open: "«", close: "»" },
    secondary: { open: "'", close: "'" },
  },
  ru: {
    primary: { open: "«", close: "»" },
    secondary: { open: "„", close: "“" },
  },
  "zh-CN": {
    primary: { open: "“", close: "”" },
    secondary: { open: "‘", close: "’" },
  },
} as const satisfies Record<string, MagicQuotePairs>;

/** Locale keys with a known magic-quote pair. */
export type QuoteStyle = keyof typeof MAGIC_QUOTES_PAIRS;

// ---------------------------------------------------------------------------
// Configuration facet
// ---------------------------------------------------------------------------

/** A single autocorrect replacement: `key` typed text → `value`. */
export interface AutocorrectReplacement {
  readonly key: string;
  readonly value: string;
}

/** Autocorrect configuration provided via {@link autocorrectConfig}. */
export interface AutocorrectConfig {
  /** Master switch: gates replacements, magic quotes, and backspace. */
  readonly enabled: boolean;
  /** Whether `"`/`'` insert typographic quotes (requires `enabled`). */
  readonly magicQuotes: boolean;
  /** Locale key selecting the quote pairs. */
  readonly quoteStyle: QuoteStyle;
  /** Replacement table applied when Space or Enter is pressed. */
  readonly replacements: readonly AutocorrectReplacement[];
}

/**
 * Default replacement table, copied from Zettlr's config template
 * (`get-config-template.ts`), plus the short single-arrow forms
 * (`->`, `<-`, `=>`).
 */
export const DEFAULT_REPLACEMENTS: readonly AutocorrectReplacement[] = [
  // Arrows
  { key: "->", value: "→" },
  { key: "-->", value: "→" },
  { key: "–>", value: "→" }, // For Word-mode arrows (-- already became –)
  { key: "<-", value: "←" },
  { key: "<--", value: "←" },
  { key: "<->", value: "↔" },
  { key: "<-->", value: "↔" },
  { key: "=>", value: "⇒" },
  { key: "==>", value: "⇒" },
  { key: "<==", value: "⇐" },
  { key: "<=>", value: "⇔" },
  { key: "<==>", value: "⇔" },
  // Mathematical symbols
  { key: "!=", value: "≠" },
  { key: "<>", value: "≠" },
  { key: "+-", value: "±" },
  { key: ":time:", value: "×" },
  { key: ":division:", value: "÷" },
  { key: "<=", value: "≤" },
  { key: ">=", value: "≥" },
  { key: "1/2", value: "½" },
  { key: "1/3", value: "⅓" },
  { key: "2/3", value: "⅔" },
  { key: "1/4", value: "¼" },
  { key: "3/4", value: "¾" },
  { key: "1/8", value: "⅛" },
  { key: "3/8", value: "⅜" },
  { key: "5/8", value: "⅝" },
  { key: "7/8", value: "⅞" },
  // Units
  { key: "mm2", value: "mm²" },
  { key: "cm2", value: "cm²" },
  { key: "m2", value: "m²" },
  { key: "km2", value: "km²" },
  { key: "mm3", value: "mm³" },
  { key: "cm3", value: "cm³" },
  { key: "ccm", value: "cm³" },
  { key: "m3", value: "m³" },
  { key: "km3", value: "km³" },
  { key: ":sup2:", value: "²" },
  { key: ":sup3:", value: "³" },
  { key: ":deg:", value: "°" },
  // Currencies
  { key: ":eur", value: "€" },
  { key: ":gbp", value: "£" },
  { key: ":yen", value: "¥" },
  { key: ":cent", value: "¢" },
  { key: ":inr:", value: "₹" },
  // Special symbols
  { key: "(c)", value: "©" },
  { key: "(tm)", value: "™" },
  { key: "(r)", value: "®" },
  // Interpunctuation
  { key: "...", value: "…" },
  { key: "--", value: "–" },
  { key: "---", value: "—" },
];

const DEFAULT_CONFIG: AutocorrectConfig = {
  enabled: true,
  magicQuotes: true,
  quoteStyle: "en-US",
  replacements: DEFAULT_REPLACEMENTS,
};

/**
 * CM6 Facet holding the autocorrect configuration.
 *
 * Hosts provide partial values; missing keys fall back to the defaults.
 * Higher-precedence providers win per key.
 */
export const autocorrectConfig = Facet.define<
  Partial<AutocorrectConfig>,
  AutocorrectConfig
>({
  combine(values) {
    return values.reduceRight<AutocorrectConfig>(
      (merged, value) => ({ ...merged, ...value }),
      DEFAULT_CONFIG,
    );
  },
});

// ---------------------------------------------------------------------------
// Protected ranges (code, math, comments, HTML, frontmatter)
// ---------------------------------------------------------------------------

/**
 * Lezer node types whose content must never be autocorrected. Mirrors the
 * node-exclusion approach in spellcheck.ts (code + math) plus Zettlr's
 * extra protected nodes (comments, HTML, horizontal rules).
 */
const PROTECTED_TYPES = new Set([
  ...NO_SPELLCHECK_TYPES,
  "CodeText",
  "CodeBlock",
  "CommentBlock",
  "HTMLBlock",
  "HTMLTag",
  "HorizontalRule",
]);

/**
 * Whether `pos` sits inside a range where autocorrect must stay inactive:
 * a protected syntax node, or the YAML frontmatter block. Frontmatter is
 * not a Lezer node in Coflat's parser, so it is checked through
 * `frontmatterField` (bundled with the extension).
 */
function inProtectedRange(state: EditorState, pos: number): boolean {
  const frontmatterEnd = state.field(frontmatterField, false)?.end ?? -1;
  if (frontmatterEnd >= 0 && pos < frontmatterEnd) return true;
  return (
    findAncestor(
      syntaxTree(state).resolveInner(pos, -1),
      (node) => PROTECTED_TYPES.has(node.name),
    ) !== null
  );
}

// ---------------------------------------------------------------------------
// Replacements (Space/Enter)
// ---------------------------------------------------------------------------

/**
 * Run the replacement table against the text before every cursor. Expects
 * to be called immediately AFTER the Space/newline insertion transaction,
 * so it looks one position left of each cursor.
 *
 * Dispatches all replacements in one transaction annotated with
 * `isolateHistory.of("full")`: a single Undo reverts only the replacement
 * and keeps the typed space/newline.
 */
interface SortedReplacements {
  readonly sorted: readonly AutocorrectReplacement[];
  readonly maxKeyLength: number;
}

/**
 * Per-facet-value cache of the longest-key-first replacement order.
 * `handleReplacement` runs on every Space/Enter; the table is a fixed facet
 * value, so sort it once per value instead of per keystroke.
 */
const sortedReplacementsCache = new WeakMap<
  readonly AutocorrectReplacement[],
  SortedReplacements
>();

function sortedReplacements(
  replacements: readonly AutocorrectReplacement[],
): SortedReplacements {
  let entry = sortedReplacementsCache.get(replacements);
  if (!entry) {
    const sorted = [...replacements].sort((a, b) => b.key.length - a.key.length);
    entry = { sorted, maxKeyLength: sorted[0]?.key.length ?? 0 };
    sortedReplacementsCache.set(replacements, entry);
  }
  return entry;
}

export function handleReplacement(view: EditorView): boolean {
  const config = view.state.facet(autocorrectConfig);
  if (!config.enabled || config.replacements.length === 0) return false;

  const { sorted: replacements, maxKeyLength } = sortedReplacements(
    config.replacements,
  );

  const { state } = view;
  const changes: ChangeSpec[] = [];

  for (const range of state.selection.ranges) {
    // Ignore selections (only cursors).
    if (!range.empty) continue;

    // Offset by 1 since this runs after the space/newline insertion.
    const pos = range.from - 1;
    if (pos < 0) continue;
    if (inProtectedRange(state, pos)) continue;

    // Leave `---` and `...` lines alone: frontmatter delimiters on the
    // first line are not parsed as any node type (Zettlr parity).
    const line = state.doc.lineAt(pos);
    if (line.text === "---" || line.text === "...") continue;

    const sliceFrom = Math.max(pos - maxKeyLength, 0);
    const slice = state.sliceDoc(sliceFrom, pos);

    for (const { key, value } of replacements) {
      if (!slice.endsWith(key)) continue;
      const start = pos - key.length;
      // `pos` is not protected, but the match may start inside a
      // protected node (e.g. right after inline code).
      if (inProtectedRange(state, start)) break;
      changes.push({ from: start, to: pos, insert: value });
      break; // Do not check the other possible replacements.
    }
  }

  if (changes.length === 0) return false;

  view.dispatch({ changes, annotations: isolateHistory.of("full") });
  return true;
}

/**
 * Space key command: insert the space first (so the replacement lands after
 * it in the undo history), then run the replacement pass.
 *
 * Returns false when autocorrect is disabled so the default space insertion
 * takes over.
 */
export const handleAutocorrectSpace: Command = (view) => {
  const config = view.state.facet(autocorrectConfig);
  if (!config.enabled || config.replacements.length === 0) return false;

  view.dispatch(view.state.replaceSelection(" "), {
    userEvent: "input.type",
    scrollIntoView: true,
  });
  handleReplacement(view);

  // The space was dispatched either way, so the key is consumed.
  return true;
};

/**
 * Enter key command: mimic the default Enter chain
 * (`insertNewlineContinueMarkup` → `insertNewlineAndIndent`) so lists keep
 * being continued, then run the replacement pass.
 */
export const handleAutocorrectEnter: Command = (view) => {
  const config = view.state.facet(autocorrectConfig);
  if (!config.enabled || config.replacements.length === 0) return false;

  if (!(insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view))) {
    return false;
  }
  handleReplacement(view);

  // The newline was dispatched either way, so the key is consumed.
  return true;
};

// ---------------------------------------------------------------------------
// Magic quotes
// ---------------------------------------------------------------------------

/** Characters that may directly precede an OPENING magic quote. */
const OPENING_PRECEDERS = " ([{-–—\n\r\t\v\f/\\";

/** Resolve the configured quote pair for a straight quote character. */
function quotePairFor(config: AutocorrectConfig, quote: '"' | "'"): QuotePair {
  const pairs = MAGIC_QUOTES_PAIRS[config.quoteStyle];
  return quote === '"' ? pairs.primary : pairs.secondary;
}

/**
 * Build the keymap command for a straight quote key (`"` or `'`).
 *
 * Empty cursor: insert the opening quote when the preceding character (or
 * start of document) allows it, the closing quote otherwise. Non-empty
 * selection: surround it with the pair. Inside protected ranges the
 * straight character is inserted verbatim (still consumed here so mixed
 * protected/unprotected multi-cursor edits stay in one transaction).
 */
export function handleQuote(quote: '"' | "'"): Command {
  return (view) => {
    const config = view.state.facet(autocorrectConfig);
    if (!config.enabled || !config.magicQuotes) return false;

    const pair = quotePairFor(config, quote);
    const { state } = view;

    const transaction = state.changeByRange((range) => {
      const isFromProtected = inProtectedRange(state, range.from);
      const isToProtected = inProtectedRange(state, range.to);

      if (range.empty) {
        const charBefore = range.from === 0
          ? " " // Document start behaves like a space (opens a quote).
          : state.sliceDoc(range.from - 1, range.from);
        const insert = isFromProtected
          ? quote // `from` is protected, so no fancy quotes.
          : OPENING_PRECEDERS.includes(charBefore)
            ? pair.open
            : pair.close;

        return {
          range: EditorSelection.cursor(range.from + insert.length),
          changes: { from: range.from, to: range.to, insert },
        };
      }

      // Surround the selection with quotes, keeping the text selected.
      const text = state.sliceDoc(range.from, range.to);
      const open = isFromProtected ? quote : pair.open;
      const close = isToProtected ? quote : pair.close;
      return {
        range: EditorSelection.range(
          range.from + open.length,
          range.to + open.length,
        ),
        changes: {
          from: range.from,
          to: range.to,
          insert: `${open}${text}${close}`,
        },
      };
    });

    view.dispatch(transaction, {
      userEvent: "input.type",
      scrollIntoView: true,
    });
    return true;
  };
}

/**
 * Backspace command: when the character(s) immediately before a cursor form
 * a magic quote, downgrade it to the straight character instead of deleting
 * it. Handles multi-character quotes (e.g. French `« `). Returns false when
 * nothing was downgraded so the default deletion runs.
 */
interface BackspaceCandidate {
  readonly text: string;
  readonly straight: string;
}

/** Quote-downgrade candidates per style, computed once (Backspace hot path). */
const backspaceCandidatesCache = new Map<QuoteStyle, readonly BackspaceCandidate[]>();

function backspaceCandidates(quoteStyle: QuoteStyle): readonly BackspaceCandidate[] {
  let candidates = backspaceCandidatesCache.get(quoteStyle);
  if (!candidates) {
    const pairs = MAGIC_QUOTES_PAIRS[quoteStyle];
    candidates = [
      { text: pairs.primary.open, straight: '"' },
      { text: pairs.primary.close, straight: '"' },
      { text: pairs.secondary.open, straight: "'" },
      { text: pairs.secondary.close, straight: "'" },
    ]
      // Skip pairs that already use the straight character (e.g. Italian
      // secondary quotes) — Backspace should just delete those.
      .filter(({ text, straight }) => text !== straight)
      // Longer quotes first so `« ` wins over a shorter overlapping match.
      .sort((a, b) => b.text.length - a.text.length);
    backspaceCandidatesCache.set(quoteStyle, candidates);
  }
  return candidates;
}

export const handleAutocorrectBackspace: Command = (view) => {
  const config = view.state.facet(autocorrectConfig);
  if (!config.enabled || !config.magicQuotes) return false;

  const candidates = backspaceCandidates(config.quoteStyle);

  const changes: ChangeSpec[] = [];
  for (const range of view.state.selection.ranges) {
    if (range.from === 0 || !range.empty) continue;
    for (const { text, straight } of candidates) {
      const from = range.from - text.length;
      if (from >= 0 && view.state.sliceDoc(from, range.from) === text) {
        changes.push({ from, to: range.from, insert: straight });
        break;
      }
    }
  }

  if (changes.length === 0) return false;

  // If we've replaced a quote, CodeMirror must not also delete it.
  view.dispatch({ changes });
  return true;
};

// ---------------------------------------------------------------------------
// Extension bundle
// ---------------------------------------------------------------------------

const autocorrectKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Space", run: handleAutocorrectSpace },
    { key: "Enter", run: handleAutocorrectEnter },
    { key: "Backspace", run: handleAutocorrectBackspace },
    { key: '"', run: handleQuote('"') },
    { key: "'", run: handleQuote("'") },
  ]),
);

/**
 * Self-contained autocorrect + magic quotes extension.
 *
 * Bundles the config facet value, the `frontmatterField` dependency (CM6
 * deduplicates it when the host already includes it), and a `Prec.high`
 * keymap for Space/Enter/Backspace/`"`/`'`.
 */
export function autocorrectExtension(
  config: Partial<AutocorrectConfig> = {},
): Extension {
  return [
    autocorrectConfig.of(config),
    frontmatterField,
    autocorrectKeymap,
  ];
}
