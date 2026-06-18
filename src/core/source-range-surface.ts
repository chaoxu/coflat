export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface SourceRangeAttrsOptions {
  readonly sourceRange?: SourceRange | null;
  readonly sourceLine?: number | null;
}

export interface ParseSourceRangeOptions {
  readonly defaultToFrom?: boolean;
  readonly requirePositive?: boolean;
}

export interface ElementSourceRangeOptions extends ParseSourceRangeOptions {
  readonly closest?: boolean;
}

export function parseSourceOffset(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sourceRangeFromValues(
  fromValue: string | null | undefined,
  toValue: string | null | undefined,
  options: ParseSourceRangeOptions = {},
): SourceRange | null {
  const from = parseSourceOffset(fromValue);
  if (from === null) return null;
  const to = parseSourceOffset(toValue) ?? (options.defaultToFrom ? from : null);
  if (to === null) return null;
  if (options.requirePositive && from >= to) return null;
  return { from, to };
}

export function sourceRangeFromDataset(
  dataset: DOMStringMap,
  fromKey: string,
  toKey: string,
  options: ParseSourceRangeOptions = {},
): SourceRange | null {
  return sourceRangeFromValues(dataset[fromKey], dataset[toKey], options);
}

export function sourceRangeFromElement(
  element: Element,
  options: ElementSourceRangeOptions = {},
): SourceRange | null {
  const carrier = element.hasAttribute("data-source-from")
    ? element
    : options.closest
    ? element.closest("[data-source-from][data-source-to]")
    : null;
  if (!carrier) return null;
  return sourceRangeFromValues(
    carrier.getAttribute("data-source-from"),
    carrier.getAttribute("data-source-to"),
    options,
  );
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
