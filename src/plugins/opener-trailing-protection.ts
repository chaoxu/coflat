import { EditorState, type Extension, type Transaction } from "@codemirror/state";
import { collectFencedDivs } from "../fenced-block/model";
import { fenceOperationAnnotation } from "./fence-protection";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

/**
 * Block insertions that would corrupt the opener line of a fenced div by
 * placing non-whitespace text after the attribute block `}`. A canonical
 * Pandoc fenced-div opener requires nothing but whitespace after `{...}`;
 * any other character causes the parser to reject the line, which makes
 * the block (and its number) silently disappear from the rendered view.
 *
 * The corruption is reachable when a user clicks just past a short title
 * widget (e.g. `(A)`) and the cursor lands at end-of-opener-line, then
 * the user types — the typed text lands between `}` and the newline.
 */
function shouldBypass(tr: Transaction): boolean {
  return !tr.docChanged
    || Boolean(tr.annotation(fenceOperationAnnotation))
    || Boolean(tr.annotation(programmaticDocumentChangeAnnotation));
}

function insertedTextHasOpenerCorruptingChar(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    if (ch === 0x0a /* \n */) return false;
    if (ch !== 0x20 /* space */ && ch !== 0x09 /* tab */) return true;
  }
  return false;
}

interface TrailingRange {
  readonly from: number;
  readonly to: number;
}

function collectOpenerTrailingRanges(state: EditorState): TrailingRange[] {
  const divs = collectFencedDivs(state);
  const ranges: TrailingRange[] = [];
  for (const div of divs) {
    if (div.singleLine) continue;
    const lineEnd = state.doc.lineAt(div.openFenceFrom).to;
    const from = div.openFenceTo;
    if (from < 0 || from > lineEnd) continue;
    ranges.push({ from, to: lineEnd });
  }
  return ranges;
}

export const openerTrailingProtection: Extension = EditorState.transactionFilter.of((tr) => {
  if (shouldBypass(tr)) return tr;

  const ranges = collectOpenerTrailingRanges(tr.startState);
  if (ranges.length === 0) return tr;

  let blocked = false;
  tr.changes.iterChanges((fromOld, _toOld, _fromNew, _toNew, inserted) => {
    if (blocked) return;
    if (inserted.length === 0) return;
    const insertedText = inserted.toString();
    if (!insertedTextHasOpenerCorruptingChar(insertedText)) return;
    for (const range of ranges) {
      // Block any insertion whose anchor (point of insert) lies inside the
      // trailing area, since it ends up on the opener line and breaks the
      // strict `:::` + `{...}` shape required by the parser.
      if (fromOld >= range.from && fromOld <= range.to) {
        blocked = true;
        return;
      }
    }
  });

  return blocked ? [] : tr;
});
