/**
 * Fence info-string (language) autocomplete.
 *
 * Offers known code-fence languages while the caret sits at the end of a
 * ``` / ~~~ opener line. Characters already typed after the fence are
 * captured as the query instead of blocking the trigger, which keeps the
 * popup working with dead-key keyboard layouts (Zettlr
 * autocomplete/code-blocks.ts). Applying a completion inserts the language
 * and — only while the fence is still unclosed — a blank line plus a
 * matching closing fence, leaving the caret on the blank line.
 *
 * Wiring (integrator): append `fenceLanguageAutocompleteExtension(languages)`
 * to the editor extension list. It rides the single `autocompletion` instance
 * owned by `referenceAutocompleteExtension` (which must be present) via
 * `extraCompletionSourcesFacet`. Pass the same language list the lazy
 * code-fence loader uses (`codeLanguageDescriptions` in src/editor/editor.ts
 * — `LanguageDescription[]` satisfies `FenceLanguageInfo[]` structurally).
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { NODE } from "../core/constants/node-types";
import { findAncestorByName } from "./lib/syntax-tree-helpers";
import {
  applyCompletionInsertPlan,
  type CompletionInsertPlan,
  extraCompletionSourcesFacet,
} from "./reference-autocomplete";

/**
 * Minimal structural shape of a completable fence language. CM6
 * `LanguageDescription` (name + alias) satisfies this, so the list already
 * passed to the markdown `codeLanguages` option can be reused directly.
 */
export interface FenceLanguageInfo {
  readonly name: string;
  readonly alias?: readonly string[];
}

export interface FenceLanguageCompletionMatch {
  readonly from: number;
  readonly query: string;
}

// Opener line: up to 3 leading spaces, a backtick/tilde fence, optional
// spaces and `{`, then whatever info-string characters were already typed.
// The trailing capture becomes the completion query (dead-key tolerance).
const FENCE_OPENER_RE = /^\s{0,3}([`~]{3,})\s*\{?(.*)$/;
const FENCE_INFO_QUERY_RE = /^[\w+#.-]*$/;

/**
 * True when the line at `lineFrom` opens a fenced code block, rather than
 * being content or the closing fence of one that started earlier.
 */
function isFenceOpenerLine(state: EditorState, lineFrom: number): boolean {
  const node = syntaxTree(state).resolveInner(lineFrom, 1);
  const fence = findAncestorByName(node, NODE.FencedCode);
  return !fence || fence.from >= lineFrom;
}

export function findFenceLanguageCompletionMatch(
  state: EditorState,
  pos: number,
): FenceLanguageCompletionMatch | null {
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) {
    return null;
  }
  const match = FENCE_OPENER_RE.exec(line.text);
  if (!match) {
    return null;
  }
  if (!isFenceOpenerLine(state, line.from)) {
    return null;
  }
  const query = match[2] ?? "";
  return { from: pos - query.length, query };
}

/**
 * True when the fence opened on `openerLineNumber` already has a closing
 * fence: a later line holding at least as many of the same fence characters
 * and nothing else (info strings disqualify a line from closing a fence).
 */
function fenceIsClosed(
  state: EditorState,
  openerLineNumber: number,
  delim: string,
): boolean {
  const closeRe = new RegExp(`^ {0,3}[${delim[0]}]{${delim.length},}[ \\t]*$`);
  for (let n = openerLineNumber + 1; n <= state.doc.lines; n += 1) {
    if (closeRe.test(state.doc.line(n).text)) {
      return true;
    }
  }
  return false;
}

export function buildFenceLanguageInsertPlan(
  state: EditorState,
  from: number,
  info: string,
): CompletionInsertPlan {
  const line = state.doc.lineAt(from);
  const opener = FENCE_OPENER_RE.exec(line.text);
  const delim = opener?.[1] ?? "```";
  if (opener && !fenceIsClosed(state, line.number, delim)) {
    // Auto-close: language, blank line for the code, matching closing fence,
    // caret on the blank line (Zettlr autocomplete/code-blocks.ts generate).
    const cursor = info.length + 1;
    return {
      insert: `${info}\n\n${delim}`,
      selectFrom: cursor,
      selectTo: cursor,
    };
  }
  // Already closed: only replace the info string, caret after it.
  return { insert: info, selectFrom: info.length, selectTo: info.length };
}

function applyFenceLanguage(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  // The closed/unclosed decision and the fence delimiter are read at apply
  // time — the document can change while the popup is open.
  const plan = buildFenceLanguageInsertPlan(view.state, from, completion.label);
  applyCompletionInsertPlan(plan)(view, completion, from, to);
}

function buildFenceLanguageOptions(
  languages: readonly FenceLanguageInfo[],
): Completion[] {
  const seen = new Set<string>();
  const options: Completion[] = [];
  for (const language of languages) {
    if (!language.name || seen.has(language.name)) continue;
    seen.add(language.name);
    options.push({
      apply: applyFenceLanguage,
      label: language.name,
    });
    for (const alias of language.alias ?? []) {
      if (!alias || seen.has(alias)) continue;
      seen.add(alias);
      options.push({
        apply: applyFenceLanguage,
        detail: language.name,
        label: alias,
      });
    }
  }
  options.sort((a, b) => a.label.localeCompare(b.label));
  return options;
}

export function createFenceLanguageCompletionSource(
  languages: readonly FenceLanguageInfo[],
): CompletionSource {
  const options = buildFenceLanguageOptions(languages);
  return (context: CompletionContext): CompletionResult | null => {
    if (options.length === 0) {
      return null;
    }
    const match = findFenceLanguageCompletionMatch(context.state, context.pos);
    if (!match) {
      return null;
    }
    return {
      from: match.from,
      options,
      validFor: FENCE_INFO_QUERY_RE,
    };
  };
}

/**
 * Self-contained extension: contributes the fence-language completion source
 * to the shared autocompletion instance owned by
 * `referenceAutocompleteExtension`.
 */
export function fenceLanguageAutocompleteExtension(
  languages: readonly FenceLanguageInfo[],
): Extension {
  return extraCompletionSourcesFacet.of(
    createFenceLanguageCompletionSource(languages),
  );
}
