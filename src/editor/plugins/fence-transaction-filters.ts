import {
  type Annotation,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import type { FencedBlockInfo } from "../fenced-block/model";
import {
  type FenceChangeSpec,
  type FenceRange,
  collectFenceTransactionChanges,
  planFenceProtectionDecision,
} from "./fence-protection-pipeline";

type FenceRewrite = FenceChangeSpec | readonly FenceChangeSpec[];

interface FenceRewriteSpec {
  readonly changes: FenceRewrite;
  readonly annotations: Annotation<true>;
}

interface BypassFenceProtectionDeps {
  readonly shouldBypassFenceProtection: (tr: Transaction) => boolean;
}

interface RewriteFenceProtectionDeps extends BypassFenceProtectionDeps {
  readonly annotateFenceRewrite: (changes: FenceRewrite) => FenceRewriteSpec;
}

interface FenceProtectionDecisionInputs {
  readonly allFencedBlocks: readonly FencedBlockInfo[];
  readonly closingFenceRanges: readonly FenceRange[];
  readonly openingFenceColonRanges: readonly FenceRange[];
  readonly openingFenceBacktickRanges: readonly FenceRange[];
  readonly openingMathDelimiterRanges: readonly FenceRange[];
}

interface FenceProtectionTransactionFilterDeps extends RewriteFenceProtectionDeps {
  readonly getFenceProtectionDecisionInputs: (
    state: EditorState,
  ) => FenceProtectionDecisionInputs;
}

export function createFenceProtectionTransactionFilter(
  deps: FenceProtectionTransactionFilterDeps,
) {
  return EditorState.transactionFilter.of((tr) => {
    if (deps.shouldBypassFenceProtection(tr)) return tr;

    const state = tr.startState;
    const decision = planFenceProtectionDecision(
      state,
      collectFenceTransactionChanges(tr),
      deps.getFenceProtectionDecisionInputs(state),
    );

    if (decision.kind === "block") return [];
    if (decision.kind === "rewrite") return deps.annotateFenceRewrite(decision.changes);
    return tr;
  });
}
