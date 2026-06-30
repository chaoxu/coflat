/**
 * Upgrade ancestor fenced-div colon counts when a new opener lands inside an
 * existing div outside the block-type picker (paste, hand-typed `:::` in
 * source-mode round-trips, programmatic insert without the picker's
 * upgrade pass).
 *
 * Coflat's parser requires each nesting level to use strictly fewer colons
 * than its parent (see FORMAT.md). The block-type picker handles this when
 * inserting via the popup, but anything else that drops a `:::` inside an
 * existing `:::` div would silently break the parse. This filter detects
 * inserted opener-shaped lines and bumps every ancestor that doesn't already
 * have strictly more colons than its child.
 *
 * The opener and closer of each upgraded ancestor are rewritten together so
 * the partner fence keeps matching after the bump.
 */

import { syntaxTree } from "@codemirror/language";
import {
  EditorState,
  type Extension,
} from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { fenceOperationAnnotation } from "./fence-protection";

export interface AncestorFence {
  /** Position of the opener's first colon. */
  readonly openFrom: number;
  /** Position just past the opener's last colon. */
  readonly openTo: number;
  /** Position of the closer's first colon, or -1 when the div is unclosed. */
  readonly closeFrom: number;
  /** Position just past the closer's last colon, or -1 when unclosed. */
  readonly closeTo: number;
  /** Current colon count on the opener. */
  readonly colons: number;
}

/**
 * Walk parent FencedDivs from `pos` outward, returning fence ranges suitable
 * for colon-count upgrades. Order: nearest ancestor first.
 */
export function collectAncestorFencesFromTree(
  tree: Tree,
  state: EditorState,
  pos: number,
): AncestorFence[] {
  const fences: AncestorFence[] = [];
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node) {
    if (node.name === "FencedDiv") {
      const open = node.firstChild;
      const close = node.lastChild;
      if (open && open.name === "FencedDivFence") {
        const colons = state.sliceDoc(open.from, open.to).length;
        const closer = close && close !== open && close.name === "FencedDivFence"
          ? close
          : null;
        fences.push({
          openFrom: open.from,
          openTo: open.to,
          closeFrom: closer ? closer.from : -1,
          closeTo: closer ? closer.to : -1,
          colons,
        });
      }
    }
    node = node.parent;
  }
  return fences;
}

const OPENER_COLON_RE = /^[ \t]*(:{3,})[ \t]*(\S)/;
const CLOSER_COLON_RE = /^[ \t]*:{3,}[ \t]*$/;

interface OpenerCandidate {
  /** Position in the OLD doc where the insertion landed. */
  readonly oldPos: number;
  /** Colon count of the new opener. */
  readonly colons: number;
}

function findOpenerCandidatesInInsert(
  inserted: string,
  baseOldPos: number,
): OpenerCandidate[] {
  if (inserted.length === 0) return [];
  const candidates: OpenerCandidate[] = [];
  let lineStart = 0;
  while (lineStart <= inserted.length) {
    const newline = inserted.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? inserted.length : newline;
    const line = inserted.slice(lineStart, lineEnd);
    if (!CLOSER_COLON_RE.test(line)) {
      const match = OPENER_COLON_RE.exec(line);
      if (match) {
        candidates.push({ oldPos: baseOldPos, colons: match[1].length });
      }
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return candidates;
}

export const fenceAncestorUpgradeExtension: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const candidates: OpenerCandidate[] = [];
  tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.length === 0) return;
    candidates.push(...findOpenerCandidatesInInsert(inserted.toString(), fromA));
  });
  if (candidates.length === 0) return tr;

  const tree = syntaxTree(tr.startState);

  // Plan upgrades per ancestor opener position. Multiple candidates may
  // share ancestors; keep the maximum required colon count for each.
  const targets = new Map<number, { fence: AncestorFence; targetColons: number }>();

  for (const candidate of candidates) {
    const ancestors = collectAncestorFencesFromTree(tree, tr.startState, candidate.oldPos);
    let requiredMin = candidate.colons;
    for (const fence of ancestors) {
      const existing = targets.get(fence.openFrom);
      const currentTarget = existing ? existing.targetColons : fence.colons;
      if (currentTarget <= requiredMin) {
        const newCount = requiredMin + 1;
        targets.set(fence.openFrom, { fence, targetColons: newCount });
        requiredMin = newCount;
      } else {
        // This ancestor is already wide enough; its target also caps the chain.
        requiredMin = currentTarget;
      }
    }
  }

  if (targets.size === 0) return tr;

  const upgrades: { from: number; to: number; insert: string }[] = [];
  for (const { fence, targetColons } of targets.values()) {
    if (targetColons === fence.colons) continue;
    const replacement = ":".repeat(targetColons);
    upgrades.push({ from: fence.openFrom, to: fence.openTo, insert: replacement });
    if (fence.closeFrom >= 0) {
      upgrades.push({ from: fence.closeFrom, to: fence.closeTo, insert: replacement });
    }
  }

  if (upgrades.length === 0) return tr;

  upgrades.sort((a, b) => a.from - b.from);

  return [
    tr,
    {
      changes: upgrades,
      annotations: fenceOperationAnnotation.of(true),
    },
  ];
});
