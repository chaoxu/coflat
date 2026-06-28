export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export interface SourceLineRange {
  readonly from: number;
  readonly to: number;
}

export type RenderedSourceAnchorGranularity = "block" | "inline";

export interface RenderedSourceAnchor {
  readonly id: string;
  readonly kind?: string;
  readonly granularity: RenderedSourceAnchorGranularity;
  readonly sourceRange: SourceRange;
  readonly lineRange?: SourceLineRange;
  readonly selector: string;
  readonly element?: HTMLElement;
}

export interface SourcePosition {
  readonly pos: number;
  readonly line?: number;
  readonly viewportRatio?: number;
  readonly viewportY?: number;
}

export interface SourcePositionScrollOptions {
  readonly block?: ScrollLogicalPosition;
  readonly inline?: ScrollLogicalPosition;
  readonly behavior?: ScrollBehavior;
  readonly viewportRatio?: number;
}

export interface VisibleSourcePositionOptions {
  readonly viewportRatio?: number;
}

export interface SourceRangeAttrsOptions {
  readonly sourceRange?: SourceRange | null;
  readonly sourceLine?: number | null;
  readonly sourceLineRange?: SourceLineRange | null;
  readonly sourceAtomic?: boolean;
}

export interface ParseSourceRangeOptions {
  readonly defaultToFrom?: boolean;
  readonly requirePositive?: boolean;
}

export interface ElementSourceRangeOptions extends ParseSourceRangeOptions {
  readonly closest?: boolean;
}

export interface SourceRangeCarrierOptions {
  readonly ignoredClassNames?: readonly string[];
}

export interface RenderedSourceAnchorLookupOptions {
  readonly includeInline?: boolean;
  readonly maxDistance?: number;
}

export interface ReaderSourceDecoration {
  readonly anchorId?: string;
  readonly sourceRange?: SourceRange;
  readonly sourceLineRange?: SourceLineRange;
  readonly includeInline?: boolean;
  readonly className?: string;
  readonly data?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly renderOverlay?: (anchor: RenderedSourceAnchor) => HTMLElement | null | undefined;
  readonly overlayPosition?: "after" | "before" | "append";
}

const SOURCE_RANGE_CARRIER_SELECTOR = "[data-source-from][data-source-to]";
const MATH_SOURCE_CARRIER_SELECTOR = "[data-math]";
const SOURCE_ANCHOR_SELECTOR = "[data-cf-anchor-id][data-source-from][data-source-to]";
const SOURCE_ATOMIC_ATTRIBUTE = "data-source-atomic";

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
  const carrier = isSourceRangeCarrier(element)
    ? element
    : options.closest
    ? closestSourceRangeCarrier(element)
    : null;
  if (!carrier) return null;
  return sourceRangeFromValues(
    carrier.getAttribute("data-source-from"),
    carrier.getAttribute("data-source-to"),
    options,
  );
}

export function sourceLineRangeFromElement(element: Element): SourceLineRange | null {
  const from = parseSourceOffset(element.getAttribute("data-source-line"));
  if (from === null) return null;
  const to = parseSourceOffset(element.getAttribute("data-source-line-to")) ?? from;
  return { from, to };
}

export function isSourceRangeCarrier(element: Element): boolean {
  return element.hasAttribute("data-source-from") && element.hasAttribute("data-source-to");
}

export function closestSourceRangeCarrier(
  element: Element | null,
  options: SourceRangeCarrierOptions = {},
): Element | null {
  const carrier = element?.closest(SOURCE_RANGE_CARRIER_SELECTOR) ?? null;
  if (!carrier) return null;
  return options.ignoredClassNames?.some((className) => carrier.classList.contains(className))
    ? null
    : carrier;
}

export function closestMathSourceCarrier(element: Element | null): Element | null {
  return element?.closest(MATH_SOURCE_CARRIER_SELECTOR) ?? null;
}

export function markSourceRangeAtomic(element: HTMLElement): void {
  element.dataset.sourceAtomic = "true";
}

export function isAtomicSourceRangeCarrier(element: Element): boolean {
  return element.getAttribute(SOURCE_ATOMIC_ATTRIBUTE) === "true";
}

function sourcePositionValue(position: number | SourcePosition): number {
  return typeof position === "number" ? position : position.pos;
}

function sourceRangeDistance(range: SourceRange, pos: number): number {
  if (pos < range.from) return range.from - pos;
  if (pos > range.to) return pos - range.to;
  return 0;
}

function sourceRangeSpan(range: SourceRange): number {
  return Math.max(0, range.to - range.from);
}

function sourceRangeStartsAt(range: SourceRange, pos: number): boolean {
  return range.from === pos && range.to > range.from;
}

function clampViewportRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

/**
 * Pick the source-positioned rendered element nearest to the requested vertical
 * viewport ratio. This keeps mode switches anchored to the rendered object the
 * user is looking at, instead of depending on editor-specific coordinate maps.
 */
export function visibleSourcePositionInScroller(
  scroller: HTMLElement,
  options: VisibleSourcePositionOptions = {},
): SourcePosition | null {
  const rect = scroller.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const sampleRatio = clampViewportRatio(options.viewportRatio ?? 0.5);
  const sampleY = rect.top + rect.height * sampleRatio;
  let best: { range: SourceRange; distance: number; height: number; viewportRatio: number; viewportY: number } | null = null;
  let fallback: { range: SourceRange; distance: number; height: number; viewportRatio: number; viewportY: number } | null = null;
  for (const element of scroller.querySelectorAll<HTMLElement>(SOURCE_RANGE_CARRIER_SELECTOR)) {
    const elementRect = element.getBoundingClientRect();
    if (elementRect.bottom < rect.top || elementRect.top > rect.bottom) continue;
    if (getComputedStyle(element).display === "inline") continue;
    const range = sourceRangeFromElement(element);
    if (!range) continue;
    const distance = elementRect.top <= sampleY && elementRect.bottom >= sampleY
      ? 0
      : Math.min(Math.abs(elementRect.top - sampleY), Math.abs(elementRect.bottom - sampleY));
    const height = Math.max(0, elementRect.height);
    const viewportRatio = clampViewportRatio((elementRect.top - rect.top) / rect.height);
    const candidate = { range, distance, height, viewportRatio, viewportY: elementRect.top };
    if (sourceRangeSpan(range) <= 0) {
      if (!fallback || distance < fallback.distance || (distance === fallback.distance && height > fallback.height)) {
        fallback = candidate;
      }
      continue;
    }
    if (!best || distance < best.distance || (distance === best.distance && height > best.height)) {
      best = candidate;
    }
  }
  const selected = best ?? fallback;
  if (!selected) return null;
  return { pos: Math.max(0, selected.range.from), viewportRatio: selected.viewportRatio, viewportY: selected.viewportY };
}

/**
 * Find the rendered source carrier that best corresponds to a source offset.
 *
 * `renderToHtml(..., { sourcePositions: true })` emits
 * `data-source-from`/`data-source-to` on block and inline carriers. This helper
 * picks the smallest carrier containing `position`, or the nearest carrier when
 * no range contains it. Hosts use it to keep read/edit mode switches anchored
 * to the same source location instead of guessing by scroll percentage.
 */
export function sourceElementAtPosition(
  container: ParentNode,
  position: number | SourcePosition,
): HTMLElement | null {
  const pos = sourcePositionValue(position);
  if (!Number.isFinite(pos)) return null;

  let best: { element: HTMLElement; range: SourceRange; distance: number } | null = null;
  for (const element of container.querySelectorAll<HTMLElement>(SOURCE_RANGE_CARRIER_SELECTOR)) {
    const range = sourceRangeFromElement(element);
    if (!range) continue;
    const distance = sourceRangeDistance(range, pos);
    if (!best) {
      best = { element, range, distance };
      continue;
    }
    if (distance < best.distance) {
      best = { element, range, distance };
      continue;
    }
    if (distance === best.distance && sourceRangeSpan(range) < sourceRangeSpan(best.range)) {
      if (sourceRangeStartsAt(best.range, pos) && !sourceRangeStartsAt(range, pos)) continue;
      best = { element, range, distance };
    }
    if (distance === best.distance && sourceRangeStartsAt(range, pos) && !sourceRangeStartsAt(best.range, pos)) {
      best = { element, range, distance };
    }
  }
  return best?.element ?? null;
}

function anchorSelector(id: string): string {
  const escaped = globalThis.CSS?.escape
    ? globalThis.CSS.escape(id)
    : id.replace(/["\\]/g, "\\$&");
  return `[data-cf-anchor-id="${escaped}"]`;
}

function sourceRangesOverlap(a: SourceRange, b: SourceRange): boolean {
  return a.from < b.to && b.from < a.to;
}

function sourceLineRangesOverlap(a: SourceLineRange, b: SourceLineRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

function sourceRangeContainsRange(outer: SourceRange, inner: SourceRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function sourceLineRangeContainsRange(outer: SourceLineRange, inner: SourceLineRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function sourceRangeDistanceToRange(range: SourceRange, target: SourceRange): number {
  if (sourceRangesOverlap(range, target) || sourceRangeContainsRange(range, target)) return 0;
  if (range.to <= target.from) return target.from - range.to;
  return range.from - target.to;
}

function anchorFromElement(element: HTMLElement): RenderedSourceAnchor | null {
  const sourceRange = sourceRangeFromElement(element);
  const id = element.dataset.cfAnchorId;
  if (!sourceRange || !id) return null;
  const kind = element.dataset.cfBlockKind ?? element.dataset.cfAnchorKind;
  const granularity = element.dataset.cfAnchorGranularity === "inline" ? "inline" : "block";
  const lineRange = sourceLineRangeFromElement(element) ?? undefined;
  return {
    id,
    ...(kind ? { kind } : {}),
    granularity,
    sourceRange,
    ...(lineRange ? { lineRange } : {}),
    selector: anchorSelector(id),
    element,
  };
}

export function renderedSourceAnchorsFromDom(
  container: ParentNode,
  options: { readonly includeInline?: boolean } = {},
): RenderedSourceAnchor[] {
  const anchors: RenderedSourceAnchor[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(SOURCE_ANCHOR_SELECTOR)) {
    const anchor = anchorFromElement(element);
    if (!anchor) continue;
    if (!options.includeInline && anchor.granularity === "inline") continue;
    anchors.push(anchor);
  }
  return anchors;
}

function anchorLookupCandidates(
  container: ParentNode,
  options: RenderedSourceAnchorLookupOptions,
): RenderedSourceAnchor[] {
  const anchored = renderedSourceAnchorsFromDom(container, options);
  if (anchored.length > 0) return anchored;

  const fallback: RenderedSourceAnchor[] = [];
  let index = 0;
  for (const element of container.querySelectorAll<HTMLElement>(SOURCE_RANGE_CARRIER_SELECTOR)) {
    const range = sourceRangeFromElement(element);
    if (!range) continue;
    const display = element instanceof HTMLElement ? getComputedStyle(element).display : "";
    const granularity: RenderedSourceAnchorGranularity = display === "inline" ? "inline" : "block";
    if (!options.includeInline && granularity === "inline") continue;
    const id = element.dataset.cfAnchorId || `cf-source-${index++}`;
    const lineRange = sourceLineRangeFromElement(element) ?? undefined;
    fallback.push({
      id,
      granularity,
      sourceRange: range,
      ...(lineRange ? { lineRange } : {}),
      selector: element.dataset.cfAnchorId ? anchorSelector(element.dataset.cfAnchorId) : "",
      element,
    });
  }
  return fallback;
}

function nonOverlappingAnchors(
  anchors: RenderedSourceAnchor[],
  _target: SourceRange | SourceLineRange,
  mode: "source" | "line",
): RenderedSourceAnchor[] {
  const selected: RenderedSourceAnchor[] = [];
  for (const anchor of anchors) {
    const overlaps = selected.some((existing) =>
      mode === "source"
        ? sourceRangesOverlap(existing.sourceRange, anchor.sourceRange)
        : existing.lineRange && anchor.lineRange && sourceLineRangesOverlap(existing.lineRange, anchor.lineRange)
    );
    if (!overlaps) {
      selected.push(anchor);
      continue;
    }

    for (let index = 0; index < selected.length; index++) {
      const existing = selected[index];
      const conflict = mode === "source"
        ? sourceRangesOverlap(existing.sourceRange, anchor.sourceRange)
        : existing.lineRange && anchor.lineRange && sourceLineRangesOverlap(existing.lineRange, anchor.lineRange);
      if (!conflict) continue;
      const existingSpan = mode === "source"
        ? sourceRangeSpan(existing.sourceRange)
        : (existing.lineRange ? existing.lineRange.to - existing.lineRange.from : Infinity);
      const anchorSpan = mode === "source"
        ? sourceRangeSpan(anchor.sourceRange)
        : (anchor.lineRange ? anchor.lineRange.to - anchor.lineRange.from : Infinity);
      if (anchorSpan <= existingSpan) {
        selected[index] = anchor;
      }
    }
  }
  return selected.sort((a, b) => a.sourceRange.from - b.sourceRange.from || a.sourceRange.to - b.sourceRange.to);
}

export function renderedAnchorsForSourceRange(
  container: ParentNode,
  range: SourceRange,
  options: RenderedSourceAnchorLookupOptions = {},
): RenderedSourceAnchor[] {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return [];
  const normalized = range.from <= range.to ? range : { from: range.to, to: range.from };
  const anchors = anchorLookupCandidates(container, options)
    .map((anchor) => ({
      anchor,
      distance: sourceRangeDistanceToRange(anchor.sourceRange, normalized),
      contains: sourceRangeContainsRange(anchor.sourceRange, normalized),
      span: sourceRangeSpan(anchor.sourceRange),
    }))
    .filter((item) => item.distance <= (options.maxDistance ?? Infinity))
    .sort((a, b) =>
      a.distance - b.distance ||
      Number(b.contains) - Number(a.contains) ||
      a.anchor.sourceRange.from - b.anchor.sourceRange.from ||
      a.span - b.span
    );

  const exact = anchors.filter((item) =>
    sourceRangesOverlap(item.anchor.sourceRange, normalized) ||
    sourceRangeContainsRange(item.anchor.sourceRange, normalized)
  ).map((item) => item.anchor);
  if (exact.length > 0) return nonOverlappingAnchors(exact, normalized, "source");
  return anchors[0] ? [anchors[0].anchor] : [];
}

export function renderedAnchorsForSourceLineRange(
  container: ParentNode,
  range: SourceLineRange,
  options: RenderedSourceAnchorLookupOptions = {},
): RenderedSourceAnchor[] {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return [];
  const normalized = range.from <= range.to ? range : { from: range.to, to: range.from };
  const anchors = anchorLookupCandidates(container, options)
    .flatMap((anchor) => {
      const lineRange = anchor.lineRange;
      if (!lineRange) return [];
      return [{
        anchor,
        contains: sourceLineRangeContainsRange(lineRange, normalized),
        overlaps: sourceLineRangesOverlap(lineRange, normalized),
        distance: lineRange.to < normalized.from
          ? normalized.from - lineRange.to
          : lineRange.from > normalized.to
          ? lineRange.from - normalized.to
          : 0,
      }];
    })
    .filter((item) => item.distance <= (options.maxDistance ?? Infinity))
    .sort((a, b) =>
      a.distance - b.distance ||
      Number(b.contains) - Number(a.contains) ||
      a.anchor.sourceRange.from - b.anchor.sourceRange.from
    );
  const exact = anchors.filter((item) => item.overlaps || item.contains).map((item) => item.anchor);
  if (exact.length > 0) return nonOverlappingAnchors(exact, normalized, "line");
  return anchors[0] ? [anchors[0].anchor] : [];
}

/**
 * Scroll a rendered reader container to a source offset.
 *
 * Returns `true` when a source-positioned element was found. The host must render
 * with `sourcePositions: true`; otherwise there are no carriers to target.
 */
export function scrollReaderToSourcePosition(
  container: ParentNode,
  position: number | SourcePosition,
  options: SourcePositionScrollOptions = {},
): boolean {
  const element = sourceElementAtPosition(container, position);
  if (!element) return false;
  const viewportY = typeof position === "number" ? undefined : position.viewportY;
  if (typeof viewportY === "number" && Number.isFinite(viewportY)) {
    const scroller = container instanceof HTMLElement ? container : element.parentElement;
    if (scroller) {
      const elementRect = element.getBoundingClientRect();
      scroller.scrollTop += elementRect.top - viewportY;
      return true;
    }
  }
  const viewportRatio = options.viewportRatio ?? (typeof position === "number" ? undefined : position.viewportRatio);
  if (typeof viewportRatio === "number") {
    const scroller = container instanceof HTMLElement ? container : element.parentElement;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      scroller.scrollTop += elementRect.top - (rect.top + rect.height * clampViewportRatio(viewportRatio));
      return true;
    }
  }
  element.scrollIntoView({
    block: options.block ?? "start",
    inline: options.inline ?? "nearest",
    behavior: options.behavior ?? "auto",
  });
  return true;
}

/**
 * Map a live DOM {@link Range} back to a source byte interval, using
 * `data-source-from`/`data-source-to` attributes emitted on source carriers.
 *
 * Text endpoints map by character offset within the nearest source carrier.
 * Element endpoints collapse to the carrier's full range. Endpoints inside
 * math carriers (`data-math`) also collapse to the math carrier range because
 * hydrated math DOM does not have a character-to-source mapping.
 */
export function mapDomRangeToSource(
  range: Range,
  container: HTMLElement,
): SourceRange | null {
  const start = resolveDomRangeEndpoint(range.startContainer, range.startOffset, container, false);
  if (start === null) return null;
  const end = resolveDomRangeEndpoint(range.endContainer, range.endOffset, container, true);
  if (end === null) return null;

  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

export function mapDomNodeToSource(
  node: Node,
  container: HTMLElement,
): SourceRange | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
  if (!element || !container.contains(element)) return null;
  return sourceRangeFromElement(element, { closest: true });
}

export function mapDomPointToSource(
  node: Node,
  offset: number,
  container: HTMLElement,
): number | null {
  return resolveDomRangeEndpoint(node, offset, container, false);
}

function resolveDomRangeEndpoint(
  node: Node,
  offset: number,
  container: HTMLElement,
  atEnd: boolean,
): number | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;

  const isText = node.nodeType === Node.TEXT_NODE;

  while (el && el !== container && !isSourceRangeCarrier(el)) {
    el = el.parentElement;
  }
  if (!el || el === container || !isSourceRangeCarrier(el)) {
    return null;
  }

  const range = sourceRangeFromElement(el);
  if (!range) return null;

  let probe: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (probe && probe !== el) {
    if (isAtomicSourceRangeCarrier(probe)) {
      return atEnd ? range.to : range.from;
    }
    if (closestMathSourceCarrier(probe) === probe) {
      return atEnd ? range.to : range.from;
    }
    probe = probe.parentElement;
  }
  if (isAtomicSourceRangeCarrier(el)) {
    return atEnd ? range.to : range.from;
  }
  if (closestMathSourceCarrier(el) === el) {
    return atEnd ? range.to : range.from;
  }

  if (!isText) {
    return atEnd ? range.to : range.from;
  }

  const charsBefore = countTextCharsBefore(el, node);
  if (charsBefore < 0) {
    return atEnd ? range.to : range.from;
  }
  const candidate = range.from + charsBefore + offset;
  if (candidate < range.from) return range.from;
  if (candidate > range.to) return range.to;
  return candidate;
}

function countTextCharsBefore(root: Element, target: Node): number {
  let count = 0;
  let found = false;

  function walk(node: Node): boolean {
    if (node === target) {
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += (node as Text).data.length;
      return false;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    let child = node.firstChild;
    while (child) {
      if (walk(child)) return true;
      child = child.nextSibling;
    }
    return false;
  }

  let child = root.firstChild;
  while (child) {
    if (walk(child)) break;
    child = child.nextSibling;
  }
  return found ? count : -1;
}

export function sourceRangeAttrs({
  sourceAtomic,
  sourceLine,
  sourceLineRange,
  sourceRange,
}: SourceRangeAttrsOptions): string {
  let attrs = "";
  const lineFrom = sourceLineRange?.from ?? sourceLine;
  const lineTo = sourceLineRange?.to ?? lineFrom;
  if (lineFrom !== undefined && lineFrom !== null) {
    attrs += ` data-source-line="${lineFrom}"`;
    if (lineTo !== undefined && lineTo !== null && lineTo !== lineFrom) {
      attrs += ` data-source-line-to="${lineTo}"`;
    }
  }
  if (sourceRange) {
    attrs += ` data-source-from="${sourceRange.from}" data-source-to="${sourceRange.to}"`;
  }
  if (sourceAtomic) {
    attrs += ' data-source-atomic="true"';
  }
  return attrs;
}

export function applyReaderSourceDecorations(
  container: ParentNode,
  decorations: readonly ReaderSourceDecoration[],
): RenderedSourceAnchor[] {
  const applied: RenderedSourceAnchor[] = [];
  for (const decoration of decorations) {
    let anchors: RenderedSourceAnchor[] = [];
    if (decoration.anchorId) {
      const escaped = globalThis.CSS?.escape
        ? globalThis.CSS.escape(decoration.anchorId)
        : decoration.anchorId.replace(/["\\]/g, "\\$&");
      const element = container.querySelector<HTMLElement>(`[data-cf-anchor-id="${escaped}"]`);
      const anchor = element ? anchorFromElement(element) : null;
      if (anchor) anchors = [anchor];
    } else if (decoration.sourceRange) {
      anchors = renderedAnchorsForSourceRange(container, decoration.sourceRange, {
        includeInline: decoration.includeInline,
      });
    } else if (decoration.sourceLineRange) {
      anchors = renderedAnchorsForSourceLineRange(container, decoration.sourceLineRange, {
        includeInline: decoration.includeInline,
      });
    }

    for (const anchor of anchors) {
      const element = anchor.element;
      if (!element) continue;
      if (decoration.className) {
        element.classList.add(...decoration.className.split(/\s+/).filter(Boolean));
      }
      if (decoration.data) {
        for (const [key, value] of Object.entries(decoration.data)) {
          if (value === null || value === undefined || value === false) {
            delete element.dataset[key];
          } else {
            element.dataset[key] = String(value);
          }
        }
      }
      const overlay = decoration.renderOverlay?.(anchor);
      if (overlay) {
        overlay.dataset.cfAnchorOverlayFor = anchor.id;
        switch (decoration.overlayPosition ?? "after") {
          case "before":
            element.before(overlay);
            break;
          case "append":
            element.appendChild(overlay);
            break;
          case "after":
            element.after(overlay);
            break;
        }
      }
      applied.push(anchor);
    }
  }
  return applied;
}

export function applySourceRangeAttrs(
  element: HTMLElement,
  {
    sourceAtomic,
    sourceLine,
    sourceLineRange,
    sourceRange,
  }: SourceRangeAttrsOptions,
): void {
  const lineFrom = sourceLineRange?.from ?? sourceLine;
  const lineTo = sourceLineRange?.to ?? lineFrom;
  if (lineFrom !== undefined && lineFrom !== null) {
    element.dataset.sourceLine = String(lineFrom);
    if (lineTo !== undefined && lineTo !== null && lineTo !== lineFrom) {
      element.dataset.sourceLineTo = String(lineTo);
    }
  }
  if (sourceRange) {
    element.dataset.sourceFrom = String(sourceRange.from);
    element.dataset.sourceTo = String(sourceRange.to);
  }
  if (sourceAtomic) {
    markSourceRangeAtomic(element);
  }
}

export function clearSourceRangeAttrs(element: HTMLElement): void {
  delete element.dataset.sourceLine;
  delete element.dataset.sourceLineTo;
  delete element.dataset.sourceFrom;
  delete element.dataset.sourceTo;
  delete element.dataset.sourceAtomic;
}
