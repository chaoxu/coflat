/**
 * Fenced-div opener/closer colon-count mirror.
 *
 * Coflat's parser requires the closing fence of a div to use the same colon
 * count as the opener (see FORMAT.md and `fenced-div.ts`). When the user edits
 * one fence — typing an extra `:`, deleting one, or rewriting the line — this
 * transaction filter mirrors the new colon count to the partner fence so the
 * div stays well-formed. Without it, single-sided edits would break the parse
 * silently (an opener with no matching closer becomes an unclosed div).
 *
 * Scope:
 * - Only mirrors when exactly one fence (opener XOR closer) was touched.
 *   If the user edited both fences in the same transaction, we don't fight
 *   them.
 * - Skipped for unclosed divs (no closer to mirror to/from) and for changes
 *   already annotated as `fenceOperationAnnotation` or
 *   `programmaticDocumentChangeAnnotation`, to avoid feedback loops with the
 *   block-type picker and other programmatic edits.
 */

import { syntaxTree } from "@codemirror/language";
import {
  EditorState,
  type Extension,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isFencedDivNodeName } from "../../core/constants/node-types";
import { countColons } from "../../core/parser/fenced-div";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";
import { fenceOperationAnnotation } from "./fence-protection";

interface FenceRange {
  readonly from: number;
  readonly to: number;
}

function findFences(div: SyntaxNode): { open: FenceRange; close: FenceRange | null } | null {
  // Opener is always the first child; closer (when present) is the last child.
  // Direct lookup avoids walking every body node on hot edits inside a div.
  const first = div.firstChild;
  if (!first || first.name !== "FencedDivFence") return null;
  const open: FenceRange = { from: first.from, to: first.to };
  const last = div.lastChild;
  if (!last || last === first || last.name !== "FencedDivFence") {
    return { open, close: null };
  }
  return { open, close: { from: last.from, to: last.to } };
}

function changesTouch(
  iter: (cb: (fromA: number, toA: number) => void) => void,
  range: FenceRange,
): boolean {
  let touched = false;
  iter((fromA, toA) => {
    if (touched) return;
    if (toA >= range.from && fromA <= range.to) touched = true;
  });
  return touched;
}

export const fenceCountMirrorExtension: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  if (tr.annotation(fenceOperationAnnotation)) return tr;
  if (tr.annotation(programmaticDocumentChangeAnnotation)) return tr;

  const tree = syntaxTree(tr.startState);

  const visited = new Set<number>();
  const candidates: SyntaxNode[] = [];
  const collectFromPosition = (pos: number, side: -1 | 1) => {
    let node: SyntaxNode | null = tree.resolveInner(pos, side);
    while (node) {
      if (isFencedDivNodeName(node.name) && !visited.has(node.from)) {
        visited.add(node.from);
        candidates.push(node);
      }
      node = node.parent;
    }
  };
  tr.changes.iterChangedRanges((fromA, toA) => {
    // Resolve from both endpoints with both sides so changes that abut a
    // FencedDiv boundary (deletion at position 0 of the opener, insertion at
    // the very end of the closer) still locate the enclosing div.
    collectFromPosition(fromA, 1);
    collectFromPosition(fromA, -1);
    if (toA !== fromA) {
      collectFromPosition(toA, -1);
      collectFromPosition(toA, 1);
    }
  });

  if (candidates.length === 0) return tr;

  const iterChanges = (cb: (fromA: number, toA: number) => void) => {
    tr.changes.iterChangedRanges((fromA, toA) => cb(fromA, toA));
  };

  const mirrors: { from: number; to: number; insert: string }[] = [];

  for (const div of candidates) {
    const fences = findFences(div);
    if (!fences || !fences.close) continue;
    const { open, close } = fences;

    const openerTouched = changesTouch(iterChanges, open);
    const closerTouched = changesTouch(iterChanges, close);
    if (openerTouched === closerTouched) continue;

    const newDoc = tr.newDoc;
    const openerNewFrom = tr.changes.mapPos(open.from, 1);
    const closerNewFrom = tr.changes.mapPos(close.from, 1);

    if (openerNewFrom >= newDoc.length || closerNewFrom >= newDoc.length) continue;

    const openerSlice = newDoc.sliceString(openerNewFrom, Math.min(openerNewFrom + 32, newDoc.length));
    const closerSlice = newDoc.sliceString(closerNewFrom, Math.min(closerNewFrom + 32, newDoc.length));
    const openerNewColons = countColons(openerSlice, 0);
    const closerNewColons = countColons(closerSlice, 0);

    if (openerNewColons === closerNewColons) continue;
    if (openerNewColons < 3 || closerNewColons < 3) continue;

    if (openerTouched) {
      // Mirror to the closer. Closer was untouched, so its old-state range is
      // still valid — emit the rewrite in original-state coordinates and let
      // CM6 compose it with the user's change.
      mirrors.push({
        from: close.from,
        to: close.to,
        insert: ":".repeat(openerNewColons),
      });
    } else {
      mirrors.push({
        from: open.from,
        to: open.to,
        insert: ":".repeat(closerNewColons),
      });
    }
  }

  if (mirrors.length === 0) return tr;

  mirrors.sort((a, b) => a.from - b.from);

  return [
    tr,
    {
      changes: mirrors,
      annotations: fenceOperationAnnotation.of(true),
    },
  ];
});
