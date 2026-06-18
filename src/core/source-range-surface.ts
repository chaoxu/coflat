export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface SourceRangeAttrsOptions {
  readonly sourceRange?: SourceRange | null;
  readonly sourceLine?: number | null;
}

export function sourceRangeAttrs({
  sourceLine,
  sourceRange,
}: SourceRangeAttrsOptions): string {
  let attrs = "";
  if (sourceLine !== undefined && sourceLine !== null) {
    attrs += ` data-source-line="${sourceLine}"`;
  }
  if (sourceRange) {
    attrs += ` data-source-from="${sourceRange.from}" data-source-to="${sourceRange.to}"`;
  }
  return attrs;
}

export function applySourceRangeAttrs(
  element: HTMLElement,
  {
    sourceLine,
    sourceRange,
  }: SourceRangeAttrsOptions,
): void {
  if (sourceLine !== undefined && sourceLine !== null) {
    element.dataset.sourceLine = String(sourceLine);
  }
  if (sourceRange) {
    element.dataset.sourceFrom = String(sourceRange.from);
    element.dataset.sourceTo = String(sourceRange.to);
  }
}
