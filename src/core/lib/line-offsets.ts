/**
 * 1-based line-number lookup for source offsets.
 *
 * `buildLineOffsets` precomputes the start offset of every line; `lineAt`
 * binary-searches that table to map an offset to its 1-based line number.
 * Lines are counted over the *full* source string (frontmatter included),
 * matching how the reader emits `data-source-line`.
 *
 * No DOM, no parser — safe to import from Node, the reader, and `parse.ts`.
 */

/** Offsets of the start of each line. Line 1 starts at offset 0. */
export function buildLineOffsets(source: string): Uint32Array {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return Uint32Array.from(offsets);
}

/** 1-based line number for `pos`, given offsets from {@link buildLineOffsets}. */
export function lineAt(offsets: Uint32Array, pos: number): number {
  // Binary search for the largest i s.t. offsets[i] <= pos.
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
