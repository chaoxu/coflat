/**
 * The smallest `{from, to, insert}` turning `oldStr` into `newStr`, found by
 * trimming the common prefix and suffix.
 *
 * Replacing a document wholesale (`{from: 0, to: length}`) forces CodeMirror to
 * map every selection position to 0, so a caller that only means to sync
 * content ends up throwing the caret to the top of the document. Bounding the
 * change to the text that actually differs keeps positions outside it stable.
 */
export function minimalChange(
  oldStr: string,
  newStr: string,
): { from: number; to: number; insert: string } {
  const limit = Math.min(oldStr.length, newStr.length);
  let from = 0;
  while (from < limit && oldStr[from] === newStr[from]) from++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > from && newEnd > from && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { from, to: oldEnd, insert: newStr.slice(from, newEnd) };
}
