/**
 * Pending-region bookkeeping for incremental document analysis.
 *
 * A pending region is a span of the current document whose slice content is
 * not backed by a real parsed-tree extraction: dirty windows dropped by the
 * syntax-availability probe, the unparsed tail of a partial parse, or content
 * a structural edit may have reinterpreted at a distance.  Regions are kept
 * sorted, non-overlapping, and non-empty, in current-document coordinates.
 * All helpers preserve input identity when nothing changes so snapshot
 * fast paths stay identity checks.
 */

import { mergeDocumentRanges } from "../../lib/document-ranges";

export interface PendingRegion {
  readonly from: number;
  readonly to: number;
}

export const NO_PENDING_REGIONS: readonly PendingRegion[] = [];

export function pendingRegionsEqual(
  left: readonly PendingRegion[],
  right: readonly PendingRegion[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((region, index) =>
    region.from === right[index].from && region.to === right[index].to,
  );
}

export function pendingTailRegions(
  frontier: number,
  docLength: number,
): readonly PendingRegion[] {
  return frontier < docLength
    ? [{ from: frontier, to: docLength }]
    : NO_PENDING_REGIONS;
}

/** Sort, drop empty ranges, and merge overlapping or touching regions. */
export function coalescePendingRegions(
  regions: readonly PendingRegion[],
): readonly PendingRegion[] {
  return mergeDocumentRanges(regions.filter((region) => region.to > region.from));
}

/**
 * Map regions through a document change, over-approximating: `from` maps
 * with assoc -1 and `to` with assoc 1 so text inserted at a region boundary
 * stays pending.  Results are clamped to the new document, emptied regions
 * are dropped, and regions that merge after mapping are coalesced.
 */
export function mapPendingRegions(
  regions: readonly PendingRegion[],
  mapOldToNew: (pos: number, assoc?: number) => number,
  docLength: number,
): readonly PendingRegion[] {
  if (regions.length === 0) return regions;

  let changed = false;
  const mapped: PendingRegion[] = [];
  for (const region of regions) {
    const from = Math.max(0, Math.min(mapOldToNew(region.from, -1), docLength));
    const to = Math.max(0, Math.min(mapOldToNew(region.to, 1), docLength));
    if (to <= from) {
      changed = true;
      continue;
    }
    if (from !== region.from || to !== region.to) changed = true;
    const last = mapped[mapped.length - 1];
    if (last && from <= last.to) {
      changed = true;
      if (to > last.to) mapped[mapped.length - 1] = { from: last.from, to };
      continue;
    }
    mapped.push(from === region.from && to === region.to ? region : { from, to });
  }
  return changed ? mapped : regions;
}

/** Union of `base` and `additions`, preserving `base` identity on no-ops. */
export function mergePendingRegions(
  base: readonly PendingRegion[],
  additions: readonly PendingRegion[],
): readonly PendingRegion[] {
  const nonEmpty = additions.filter((region) => region.to > region.from);
  if (nonEmpty.length === 0) return base;
  const merged = coalescePendingRegions([...base, ...nonEmpty]);
  return pendingRegionsEqual(base, merged) ? base : merged;
}

/** Remove `removed` spans from `regions`, preserving identity on no-ops. */
export function subtractPendingRegions(
  regions: readonly PendingRegion[],
  removed: readonly PendingRegion[],
): readonly PendingRegion[] {
  if (regions.length === 0) return regions;
  const cuts = coalescePendingRegions(removed);
  if (cuts.length === 0) return regions;

  let changed = false;
  const result: PendingRegion[] = [];
  let cutIndex = 0;
  for (const region of regions) {
    let from = region.from;
    while (cutIndex < cuts.length && cuts[cutIndex].to <= from) cutIndex += 1;
    let index = cutIndex;
    while (index < cuts.length && cuts[index].from < region.to && from < region.to) {
      const cut = cuts[index];
      if (cut.from > from) result.push({ from, to: cut.from });
      from = Math.max(from, cut.to);
      changed = true;
      index += 1;
    }
    if (from < region.to) {
      result.push(from === region.from ? region : { from, to: region.to });
    }
  }
  return changed ? result : regions;
}
