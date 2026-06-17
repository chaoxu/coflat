export function blankLineRangesBetweenBlocks(source: string, from: number, to: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let pos = from;

  if (pos > 0 && source[pos - 1] !== "\n") {
    while (pos < to && source[pos] !== "\n") pos++;
    if (pos < to) pos++;
  }

  while (pos < to) {
    const lineStart = pos;
    while (pos < to && source[pos] !== "\n") pos++;
    if (pos >= to) break;

    const lineEnd = source[pos - 1] === "\r" ? pos - 1 : pos;
    if (/^[ \t]*$/.test(source.slice(lineStart, lineEnd))) {
      ranges.push([lineStart, pos + 1]);
    }
    pos++;
  }

  return ranges;
}

export function trailingBlankLineRangesAfterLastBlock(
  source: string,
  previousBlockTo: number,
): Array<[number, number]> {
  const trailingRanges = previousBlockTo < source.length
    ? blankLineRangesBetweenBlocks(source, previousBlockTo, source.length)
    : [];
  const trailingNewlines = source.match(/\n+$/)?.[0].length ?? 0;
  const missingTrailingRanges = Math.max(0, trailingNewlines - trailingRanges.length);
  if (missingTrailingRanges === 0) return trailingRanges;

  return [
    ...trailingRanges,
    ...Array.from({ length: missingTrailingRanges }, (_, index) => {
      const from = source.length - missingTrailingRanges + index;
      return [from, from + 1] as [number, number];
    }),
  ];
}
