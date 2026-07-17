import {
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionSource,
  pickedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { CSS } from "../core/constants/css-classes";
import {
  buildCitationPreviewContent,
} from "./citations/citation-preview";
import { findAncestor } from "./lib/syntax-tree-helpers";
import { getReferencePresentationModel } from "./references/presentation";
import { buildCrossrefCompletionPreviewContent } from "./render/hover-preview";
import {
  getDocumentAnalysisOrRecompute,
  getEditorDocumentReferenceCatalog,
} from "./semantics/editor-reference-catalog";
import { bibDataEffect, bibDataField } from "./state/bib-data";

const CROSSREF_SECTION = { name: "Cross-references", rank: 0 } as const;
const CITATION_SECTION = { name: "Citations", rank: 1 } as const;
const FORBIDDEN_CONTEXT_TYPES = new Set([
  "CodeText",
  "DisplayMath",
  "FencedCode",
  "InlineCode",
  "InlineMath",
  "URL",
]);
const REF_ID_CHAR_RE = /[\w:./'-]/;
const REF_QUERY_RE = /^[\w:./'-]*$/;
const COMPLETE_REF_PART_RE = /^\s*@[A-Za-z0-9_][\w:./'-]*(?:\s*,.*)?\s*$/;
const ACTIVE_REF_PART_RE = /^\s*@([\w:./'-]*)$/;
const NARRATIVE_REF_RE = /(?:^|[^\w@])@([\w:./'-]*)$/;

export type ReferenceCompletionKind =
  | "block"
  | "citation"
  | "equation"
  | "heading";

export interface ReferenceCompletionMatch {
  readonly kind: "bracketed" | "narrative";
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

export interface ReferenceCompletionCandidate {
  readonly id: string;
  readonly kind: ReferenceCompletionKind;
  readonly detail?: string;
  readonly info?: string;
  readonly preview?: string;
  /** Rendered citation form as it will appear (e.g. "(Karger 2000)"). */
  readonly formatted?: string;
  /** How often the id is already referenced in the document. */
  readonly usageCount?: number;
}

interface ReferenceAutocompleteCompletion extends Completion {
  readonly referenceCompletionKind: ReferenceCompletionKind;
  readonly citationPreview?: string;
  readonly citationFormatted?: string;
}

function isReferenceIdChar(ch: string | undefined): boolean {
  return ch !== undefined && REF_ID_CHAR_RE.test(ch);
}

function findTokenEnd(after: string): number {
  let i = 0;
  while (i < after.length && isReferenceIdChar(after[i])) {
    i += 1;
  }
  return i;
}

function isForbiddenCompletionContext(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  const safePos = Math.max(0, Math.min(pos, state.doc.length));

  for (const bias of [1, -1, 0] as const) {
    const node: SyntaxNode | null = tree.resolveInner(safePos, bias);
    if (findAncestor(node, (candidate) => FORBIDDEN_CONTEXT_TYPES.has(candidate.name))) {
      return true;
    }
  }

  return false;
}

function findBracketedReferenceMatch(
  lineFrom: number,
  before: string,
  after: string,
  pos: number,
): ReferenceCompletionMatch | null {
  const openBracket = before.lastIndexOf("[");
  if (openBracket < 0 || openBracket < before.lastIndexOf("]")) {
    return null;
  }

  const contentBefore = before.slice(openBracket + 1);
  if (!contentBefore.trimStart().startsWith("@")) {
    return null;
  }

  const parts = contentBefore.split(";");
  const activePart = parts[parts.length - 1] ?? "";
  const stableParts = parts.slice(0, -1);

  if (stableParts.some((part) => !COMPLETE_REF_PART_RE.test(part))) {
    return null;
  }

  if (activePart.includes(",")) {
    return null;
  }

  const activeMatch = ACTIVE_REF_PART_RE.exec(activePart);
  if (!activeMatch) {
    return null;
  }

  const activePartOffset = contentBefore.length - activePart.length;
  const atOffset = activePart.indexOf("@");
  if (atOffset < 0) {
    return null;
  }

  const from = lineFrom + openBracket + 1 + activePartOffset + atOffset + 1;
  const to = pos + findTokenEnd(after);
  return {
    kind: "bracketed",
    from,
    to,
    query: activeMatch[1] ?? "",
  };
}

function findNarrativeReferenceMatch(
  pos: number,
  before: string,
  after: string,
): ReferenceCompletionMatch | null {
  const match = NARRATIVE_REF_RE.exec(before);
  if (!match || match.index === undefined) {
    return null;
  }

  const fullMatch = match[0];
  const atIndex = before.length - fullMatch.length + fullMatch.lastIndexOf("@");
  const from = pos - (before.length - atIndex - 1);
  return {
    kind: "narrative",
    from,
    to: pos + findTokenEnd(after),
    query: match[1] ?? "",
  };
}

export function findReferenceCompletionMatch(
  state: EditorState,
  pos: number,
): ReferenceCompletionMatch | null {
  if (isForbiddenCompletionContext(state, pos)) {
    return null;
  }

  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const after = line.text.slice(pos - line.from);

  return (
    findBracketedReferenceMatch(line.from, before, after, pos)
    ?? findNarrativeReferenceMatch(pos, before, after)
  );
}

function isCitationCompletion(
  completion: Completion,
): completion is ReferenceAutocompleteCompletion & {
  readonly referenceCompletionKind: "citation";
  readonly citationPreview: string;
} {
  const referenceCompletion = completion as Partial<ReferenceAutocompleteCompletion>;
  return referenceCompletion.referenceCompletionKind === "citation"
    && typeof referenceCompletion.citationPreview === "string";
}

function isSemanticReferenceCompletion(
  completion: Completion,
): completion is ReferenceAutocompleteCompletion & {
  readonly referenceCompletionKind: "block" | "equation" | "heading";
} {
  const referenceCompletion = completion as Partial<ReferenceAutocompleteCompletion>;
  return referenceCompletion.referenceCompletionKind === "block"
    || referenceCompletion.referenceCompletionKind === "equation"
    || referenceCompletion.referenceCompletionKind === "heading";
}

function renderReferenceCompletionPreview(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  if (isCitationCompletion(completion)) {
    return buildCitationPreviewContent({
      entry: completion.citationPreview,
      formatted: completion.citationFormatted,
    });
  }

  return isSemanticReferenceCompletion(completion)
    ? buildCrossrefCompletionPreviewContent(view, completion.label)
    : null;
}

function referenceCompletionOptionClass(completion: Completion): string {
  if (isCitationCompletion(completion)) {
    return `${CSS.referenceCompletionPreview} ${CSS.referenceCompletionCitation}`;
  }

  return isSemanticReferenceCompletion(completion)
    ? `${CSS.referenceCompletionPreview} ${CSS.referenceCompletionCrossref}`
    : "";
}

/**
 * Counts how often each reference id already occurs in the document, read
 * from the incremental analysis `references` slice. Citation completions use
 * these counts to float frequently-cited entries to the top (Zettlr
 * autocomplete/citations.ts, sortCitationKeysByUsage).
 */
export function collectReferenceUsageCounts(
  state: EditorState,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const reference of getDocumentAnalysisOrRecompute(state).references) {
    for (const id of reference.ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function collectReferenceCompletionCandidates(
  state: EditorState,
): ReferenceCompletionCandidate[] {
  const candidates = new Map<string, ReferenceCompletionCandidate>();
  const catalog = getEditorDocumentReferenceCatalog(state);
  const presentation = getReferencePresentationModel(state);

  for (const target of catalog.targets) {
    if (!target.id || candidates.has(target.id)) continue;

    switch (target.kind) {
      case "block":
        candidates.set(target.id, {
          id: target.id,
          kind: "block",
          detail: presentation.getDisplayText(target.id),
          info: target.title,
        });
        break;
      case "equation":
        candidates.set(target.id, {
          id: target.id,
          kind: "equation",
          detail: presentation.getDisplayText(target.id),
          info: target.text,
        });
        break;
      case "heading":
        candidates.set(target.id, {
          id: target.id,
          kind: "heading",
          detail: presentation.getDisplayText(target.id),
          info: target.title,
        });
        break;
    }
  }

  const store = state.field(bibDataField, false)?.store;
  if (store) {
    const usageCounts = collectReferenceUsageCounts(state);
    // No pre-sort: completion order is fully encoded by candidateToCompletion's
    // sortText (usage count desc, then id), which CM6 uses regardless of
    // input order.
    for (const item of store.values()) {
      if (candidates.has(item.id)) continue;
      const formatted = presentation.cite([item.id], []);
      candidates.set(item.id, {
        id: item.id,
        kind: "citation",
        detail: presentation.getDisplayText(item.id),
        preview: presentation.getPreviewText(item.id),
        formatted: formatted || undefined,
        usageCount: usageCounts.get(item.id) ?? 0,
      });
    }
  }

  return [...candidates.values()];
}

function candidateDisplayLabel(candidate: ReferenceCompletionCandidate): string {
  switch (candidate.kind) {
    case "block":
      return candidate.info ?? candidate.detail ?? candidate.id;
    case "equation":
      return candidate.detail ?? candidate.id;
    case "heading":
      return candidate.info ?? candidate.detail ?? candidate.id;
    case "citation":
      return candidate.id;
  }
}

function candidateCompletionDetail(
  candidate: ReferenceCompletionCandidate,
): string | undefined {
  return candidate.kind === "citation" ? candidate.detail : candidate.id;
}

const CITATION_USAGE_SORT_CEILING = 999_999;

/**
 * Encodes a usage count as a fixed-width, inverted decimal key so that
 * lexicographic sortText comparison ranks higher counts first.
 */
function citationUsageSortKey(usageCount: number): string {
  const inverted = CITATION_USAGE_SORT_CEILING
    - Math.min(Math.max(usageCount, 0), CITATION_USAGE_SORT_CEILING);
  return String(inverted).padStart(6, "0");
}

function candidateToCompletion(
  candidate: ReferenceCompletionCandidate,
): ReferenceAutocompleteCompletion {
  const displayLabel = candidateDisplayLabel(candidate);
  const baseCompletion = {
    detail: candidateCompletionDetail(candidate),
    label: candidate.id,
    ...(displayLabel !== candidate.id ? { displayLabel } : {}),
  } as const;

  switch (candidate.kind) {
    case "block":
      return {
        ...baseCompletion,
        referenceCompletionKind: "block",
        section: CROSSREF_SECTION,
        sortText: `0-${candidate.id}`,
      };
    case "equation":
      return {
        ...baseCompletion,
        referenceCompletionKind: "equation",
        section: CROSSREF_SECTION,
        sortText: `1-${candidate.id}`,
      };
    case "heading":
      return {
        ...baseCompletion,
        referenceCompletionKind: "heading",
        section: CROSSREF_SECTION,
        sortText: `2-${candidate.id}`,
      };
    case "citation":
      return {
        ...baseCompletion,
        citationPreview: candidate.preview,
        citationFormatted: candidate.formatted,
        referenceCompletionKind: "citation",
        section: CITATION_SECTION,
        sortText: `3-${citationUsageSortKey(candidate.usageCount ?? 0)}-${candidate.id}`,
      };
  }
}

/**
 * Insertion plan for a completion whose applied text contains a title/label
 * portion the user will likely retype (e.g. host file-link completions that
 * insert `target|Title`). Offsets are relative to `insert`.
 */
export interface CompletionInsertPlan {
  /** Exact text spliced over the completed range. */
  readonly insert: string;
  /** Start (offset into `insert`) of the title/label portion to select. */
  readonly selectFrom: number;
  /** End of the selected portion; equal to `selectFrom` for a bare cursor. */
  readonly selectTo: number;
}

/**
 * Builds a CM6 completion `apply` callback that inserts `plan.insert` and
 * leaves the designated title/label portion selected, so the user can
 * immediately type over it (Zettlr autocomplete/files.ts post-apply title
 * selection). A zero-length portion degenerates to cursor placement.
 */
export function applyCompletionInsertPlan(
  plan: CompletionInsertPlan,
): (view: EditorView, completion: Completion, from: number, to: number) => void {
  return (view, completion, from, to) => {
    const anchor = from + Math.min(Math.max(plan.selectFrom, 0), plan.insert.length);
    const head = from + Math.min(Math.max(plan.selectTo, 0), plan.insert.length);
    view.dispatch({
      annotations: pickedCompletion.of(completion),
      changes: { from, to, insert: plan.insert },
      selection: { anchor, head },
      userEvent: "input.complete",
    });
  };
}

/**
 * Additional CM6 completion sources served by the single `autocompletion`
 * instance this module owns. `autocompletion({ override })` cannot be
 * instantiated twice with different overrides (CM6 config-merge conflict),
 * so self-contained feature modules contribute their sources through this
 * facet instead (e.g. the fence-language completion). Sources are tried in
 * facet order; the first non-null result wins.
 */
export const extraCompletionSourcesFacet = Facet.define<CompletionSource>();

const extraCompletionSource: CompletionSource = async (context) => {
  for (const source of context.state.facet(extraCompletionSourcesFacet)) {
    const result = await source(context);
    if (result) {
      return result;
    }
  }
  return null;
};

export const referenceCompletionSource: CompletionSource = (
  context: CompletionContext,
) => {
  const match = findReferenceCompletionMatch(context.state, context.pos);
  if (!match) {
    return null;
  }

  const options = collectReferenceCompletionCandidates(context.state).map(candidateToCompletion);
  if (options.length === 0) {
    return null;
  }

  return {
    from: match.from,
    to: match.to,
    options,
    validFor: REF_QUERY_RE,
  };
};

function shouldRefreshReferenceCompletion(update: ViewUpdate): boolean {
  if (!update.transactions.some((tr) => tr.effects.some((effect) => effect.is(bibDataEffect)))) {
    return false;
  }

  const beforeBib = update.startState.field(bibDataField, false);
  const afterBib = update.state.field(bibDataField, false);
  if (beforeBib?.store === afterBib?.store) {
    return false;
  }

  const selection = update.state.selection.main;
  return selection.empty && findReferenceCompletionMatch(update.state, selection.head) !== null;
}

const refreshReferenceCompletionOnBibliographyUpdate = EditorView.updateListener.of((update) => {
  if (!shouldRefreshReferenceCompletion(update)) {
    return;
  }
  startCompletion(update.view);
});

export const referenceAutocompleteExtension: Extension = [
  autocompletion({
    activateOnTyping: true,
    activateOnTypingDelay: 0,
    addToOptions: [{ render: renderReferenceCompletionPreview, position: 90 }],
    optionClass: referenceCompletionOptionClass,
    override: [referenceCompletionSource, extraCompletionSource],
    tooltipClass: () => CSS.referenceCompletionTooltip,
  }),
  refreshReferenceCompletionOnBibliographyUpdate,
];
