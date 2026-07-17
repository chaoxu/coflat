import { syntaxTree } from "@codemirror/language";
import { Annotation, type Transaction } from "@codemirror/state";
import { coalesceChangedRanges } from "./dirty-windows";
import type { RawChangedRange, SemanticDelta } from "./types";

export const semanticGlobalInvalidationAnnotation = Annotation.define<true>();

/**
 * Marks an otherwise-empty transaction as an idle pending-drain tick: the
 * analysis engine consumes a bounded chunk of pending regions even though
 * neither the document nor the syntax tree changed.
 */
export const semanticPendingDrainAnnotation = Annotation.define<true>();

export interface SemanticDeltaBuildOptions {
  readonly dirtyWindowGap?: number;
}

const INLINE_PROSE_SAFE_CHANGE_RE = /^[A-Za-z0-9 ,.;!?'"()/_-]*$/;

/**
 * Line shapes that reinterpret structure at a distance when created or
 * destroyed: `---` (thematic break, setext H2 underline, frontmatter
 * delimiter), `===` (setext H1 underline), `___`/`***` (thematic breaks),
 * and ```` ``` ````/`~~~`/`:::` (fence toggles). `-` and `_` are reachable by
 * inserting characters from the safe set above; the others only by deleting
 * safe characters around them (e.g. removing the `x` from `x---`), which is
 * why the whole family is checked. Markers may be interleaved with spaces
 * (`- - -` is a thematic break); leading indent is accepted conservatively
 * (over-matching only routes rare lines onto the heavy path).
 */
const DELIMITER_LINE_RE = /^[ \t]*([-_*=:~`])(?:[ \t]*\1)*[ \t]*$/;

function isPlainInlineText(text: string): boolean {
  return text.length === 0 || (
    !text.includes("\n")
    && !text.includes("\r")
    && INLINE_PROSE_SAFE_CHANGE_RE.test(text)
  );
}

function detectPlainInlineTextOnlyChange(tr: Transaction): boolean {
  if (!tr.docChanged) {
    return false;
  }

  let plain = true;
  tr.changes.iterChanges((fromOld, toOld, fromNew, _toNew, inserted) => {
    if (!plain) return;
    const removedText = tr.startState.doc.sliceString(fromOld, toOld);
    const insertedText = inserted.sliceString(0, inserted.length);
    if (!isPlainInlineText(removedText) || !isPlainInlineText(insertedText)) {
      plain = false;
      return;
    }
    // Character-class safety alone is not enough: a safe keystroke can
    // complete a delimiter line (typing the final `-` of `---`) or destroy
    // one (inserting prose into an existing `---`), reinterpreting content
    // far outside the changed range — closing frontmatter, forming a
    // thematic break or setext underline. Removed and inserted text contain
    // no newline here, so each change touches exactly one old and one new
    // line; checking both directions stays O(changed lines).
    if (
      DELIMITER_LINE_RE.test(tr.newDoc.lineAt(fromNew).text)
      || DELIMITER_LINE_RE.test(tr.startState.doc.lineAt(fromOld).text)
    ) {
      plain = false;
    }
  });

  return plain;
}

function collectRawChangedRanges(tr: Transaction): RawChangedRange[] {
  const ranges: RawChangedRange[] = [];
  tr.changes.iterChangedRanges((fromOld, toOld, fromNew, toNew) => {
    ranges.push({ fromOld, toOld, fromNew, toNew });
  }, true);
  return ranges;
}

interface SingleInsertionChange {
  readonly pos: number;
  readonly delta: number;
}

function getSingleInsertionChange(
  rawChangedRanges: readonly RawChangedRange[],
): SingleInsertionChange | null {
  if (rawChangedRanges.length !== 1) {
    return null;
  }

  const change = rawChangedRanges[0];
  if (change.fromOld !== change.toOld || change.fromNew === change.toNew) {
    return null;
  }

  return {
    pos: change.fromOld,
    delta: change.toNew - change.fromNew,
  };
}

function mapOldToNewSingleInsertion(
  pos: number,
  assoc: number,
  change: SingleInsertionChange,
): number {
  if (pos < change.pos) {
    return pos;
  }
  if (pos > change.pos) {
    return pos + change.delta;
  }
  return assoc < 0 ? change.pos : change.pos + change.delta;
}

function mapNewToOldSingleInsertion(
  pos: number,
  assoc: number,
  change: SingleInsertionChange,
): number {
  if (pos < change.pos) {
    return pos;
  }
  if (pos > change.pos + change.delta) {
    return pos - change.delta;
  }
  if (pos < change.pos + change.delta) {
    return change.pos;
  }
  return assoc < 0 ? change.pos : pos - change.delta;
}

export function buildSemanticDelta(
  tr: Transaction,
  options: SemanticDeltaBuildOptions = {},
): SemanticDelta {
  const rawChangedRanges = collectRawChangedRanges(tr);
  const syntaxTreeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
  const singleInsertion = getSingleInsertionChange(rawChangedRanges);

  return {
    rawChangedRanges,
    dirtyWindows: coalesceChangedRanges(rawChangedRanges, options.dirtyWindowGap),
    docChanged: tr.docChanged,
    syntaxTreeChanged,
    globalInvalidation: tr.annotation(semanticGlobalInvalidationAnnotation) === true,
    pendingDrain: tr.annotation(semanticPendingDrainAnnotation) === true,
    plainInlineTextOnlyChange: detectPlainInlineTextOnlyChange(tr),
    mapOldToNew(pos, assoc = -1) {
      return singleInsertion
        ? mapOldToNewSingleInsertion(pos, assoc, singleInsertion)
        : tr.changes.mapPos(pos, assoc);
    },
    mapNewToOld(pos, assoc = -1) {
      return singleInsertion
        ? mapNewToOldSingleInsertion(pos, assoc, singleInsertion)
        : tr.changes.invertedDesc.mapPos(pos, assoc);
    },
  };
}
