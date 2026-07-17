import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  type ChangeSet,
  type EditorState,
  RangeSet,
  RangeSetBuilder,
  RangeValue,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { measureSync } from "../lib/perf";
import { computeAnalyzableFrontier } from "../semantics/incremental/engine";
import { mapPendingRegions } from "../semantics/incremental/pending-regions";
import {
  type DirtyRange,
  dirtyRangesFromChanges,
  expandChangeRangeToLines,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "./incremental-dirty-ranges";
import {
  classifyLocalMediaTarget,
  type LocalMediaCacheKind,
  resolveLocalMediaPathFromState,
} from "./local-media";
import { readMarkdownImageContent } from "./markdown-image";

type MediaCache = ReadonlyMap<string, unknown>;
/**
 * Short parse budget for the transaction path. Ranges the parser has not
 * reached are recorded as `pendingRanges` and reconciled once background
 * parsing covers them (media decorations tolerate late arrival), instead of
 * stalling the transaction for up to a second.
 */
const LOCAL_MEDIA_INDEX_PARSE_TIMEOUT_MS = 20;

export interface LocalMediaReference {
  readonly from: number;
  readonly to: number;
  readonly src: string;
  readonly resolvedPath: string;
  readonly cacheKind: LocalMediaCacheKind;
}

class LocalMediaReferenceValue extends RangeValue {
  constructor(
    readonly src: string,
    readonly resolvedPath: string,
    readonly cacheKind: LocalMediaCacheKind,
  ) {
    super();
  }

  eq(other: RangeValue): boolean {
    return other instanceof LocalMediaReferenceValue
      && this.src === other.src
      && this.resolvedPath === other.resolvedPath
      && this.cacheKind === other.cacheKind;
  }

  toReference(from: number, to: number): LocalMediaReference {
    return {
      from,
      to,
      src: this.src,
      resolvedPath: this.resolvedPath,
      cacheKind: this.cacheKind,
    };
  }
}

export interface LocalMediaIndex {
  readonly references: RangeSet<LocalMediaReferenceValue>;
  /** Current-doc ranges not yet covered by the syntax tree; reconciled later. */
  readonly pendingRanges: readonly DirtyRange[];
}

const EMPTY_CHANGED_MEDIA_PATHS: ReadonlySet<string> = new Set<string>();

function localMediaReferenceValue(ref: LocalMediaReference): LocalMediaReferenceValue {
  return new LocalMediaReferenceValue(ref.src, ref.resolvedPath, ref.cacheKind);
}

function buildLocalMediaReferenceSet(
  refs: readonly LocalMediaReference[],
): RangeSet<LocalMediaReferenceValue> {
  const builder = new RangeSetBuilder<LocalMediaReferenceValue>();
  for (const ref of [...refs].sort((left, right) => left.from - right.from || left.to - right.to)) {
    builder.add(ref.from, ref.to, localMediaReferenceValue(ref));
  }
  return builder.finish();
}

interface LocalMediaCollectResult {
  readonly refs: LocalMediaReference[];
  readonly uncoveredRanges: readonly DirtyRange[];
}

interface FrontierSplit {
  readonly covered: DirtyRange[];
  readonly uncovered: DirtyRange[];
}

/**
 * Split each range at the parsed frontier so the already-parsed prefix is
 * indexed immediately. All-or-nothing coverage per range would leave a
 * whole-document range (create path, large paste) unindexed until background
 * parsing reaches the very end — image widgets in the visible prefix would
 * show placeholders for the entire parse.
 */
export function splitRangesAtFrontier(
  frontier: number,
  ranges: readonly DirtyRange[],
): FrontierSplit {
  const covered: DirtyRange[] = [];
  const uncovered: DirtyRange[] = [];
  for (const range of ranges) {
    const coveredTo = Math.min(range.to, frontier);
    if (coveredTo > range.from) covered.push({ from: range.from, to: coveredTo });
    const uncoveredFrom = Math.max(range.from, frontier);
    if (range.to > uncoveredFrom) uncovered.push({ from: uncoveredFrom, to: range.to });
  }
  return { covered, uncovered };
}

function splitRangesAtParsedFrontier(
  state: EditorState,
  ranges: readonly DirtyRange[],
): FrontierSplit {
  const frontier = computeAnalyzableFrontier(
    state.doc.length,
    syntaxTree(state),
    (to) => syntaxTreeAvailable(state, to),
  );
  return splitRangesAtFrontier(frontier, ranges);
}

function collectCoveredLocalMediaReferences(
  state: EditorState,
  ranges: readonly DirtyRange[],
): LocalMediaCollectResult {
  if (ranges.length === 0) return { refs: [], uncoveredRanges: [] };
  const refs: LocalMediaReference[] = [];
  const seen = new Set<string>();
  const targetTo = ranges.reduce((maxTo, range) => Math.max(maxTo, range.to), 0);
  if (!syntaxTreeAvailable(state, targetTo)) {
    measureSync(
      "cm6.mediaIndex.ensureSyntaxTree",
      () => ensureSyntaxTree(state, targetTo, LOCAL_MEDIA_INDEX_PARSE_TIMEOUT_MS),
    );
  }
  const { covered, uncovered: uncoveredRanges } = splitRangesAtParsedFrontier(state, ranges);
  const tree = syntaxTree(state);

  for (const range of covered) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== "Image") return;
        if (!rangeIntersectsDirtyRanges(node.from, node.to, [range])) return;
        const key = `${node.from}:${node.to}`;
        if (seen.has(key)) return false;
        seen.add(key);

        const content = readMarkdownImageContent(state, node.node);
        if (!content) return false;
        const cacheKind = classifyLocalMediaTarget(content.src);
        if (!cacheKind) return false;
        const resolvedPath = resolveLocalMediaPathFromState(state, content.src);
        if (!resolvedPath) return false;

        refs.push({
          from: node.from,
          to: node.to,
          src: content.src,
          resolvedPath,
          cacheKind,
        });
        return false;
      },
    });
  }

  return { refs, uncoveredRanges };
}

export function collectLocalMediaReferencesInRanges(
  state: EditorState,
  ranges: readonly DirtyRange[],
): LocalMediaReference[] {
  return collectCoveredLocalMediaReferences(state, ranges).refs;
}

function buildLocalMediaIndex(state: EditorState): LocalMediaIndex {
  const { refs, uncoveredRanges } = collectCoveredLocalMediaReferences(state, [
    { from: 0, to: state.doc.length },
  ]);
  return {
    references: buildLocalMediaReferenceSet(refs),
    pendingRanges: uncoveredRanges,
  };
}

function mapReferenceRangeToDirtyRange(
  ref: LocalMediaReference,
  state: EditorState,
  changes: ChangeSet,
): DirtyRange {
  const mappedFrom = changes.mapPos(ref.from, 1);
  const mappedTo = changes.mapPos(ref.to, -1);
  return expandChangeRangeToLines(
    state.doc,
    Math.max(0, Math.min(mappedFrom, state.doc.length)),
    Math.max(0, Math.min(Math.max(mappedFrom, mappedTo), state.doc.length)),
  );
}

function filterLocalMediaReferencesInRanges(
  references: RangeSet<LocalMediaReferenceValue>,
  dirtyRanges: readonly DirtyRange[],
): RangeSet<LocalMediaReferenceValue> {
  let next = references;
  for (const range of dirtyRanges) {
    next = next.update({
      filterFrom: range.from,
      filterTo: range.to,
      filter: (from, to) => !rangeIntersectsDirtyRanges(from, to, [range]),
    });
  }
  return next;
}

// pendingRanges is always mergeDirtyRanges output (sorted, non-overlapping),
// which is what mapPendingRegions requires; its extra coalescing is absorbed
// by the mergeDirtyRanges the caller applies to the result.
function mapPendingMediaRanges(
  pending: readonly DirtyRange[],
  tr: Transaction,
): readonly DirtyRange[] {
  return mapPendingRegions(
    pending,
    (pos, assoc) => tr.changes.mapPos(pos, assoc),
    tr.state.doc.length,
  );
}

/** Consume the parsed prefix of pending ranges; keep the unparsed tails. */
function reconcilePendingMediaRanges(
  value: LocalMediaIndex,
  state: EditorState,
): LocalMediaIndex {
  if (value.pendingRanges.length === 0) return value;
  const { covered, uncovered: remaining } = splitRangesAtParsedFrontier(
    state,
    value.pendingRanges,
  );
  if (covered.length === 0) return value;

  const { refs, uncoveredRanges } = collectCoveredLocalMediaReferences(state, covered);
  let references = filterLocalMediaReferencesInRanges(value.references, covered);
  if (refs.length > 0) {
    references = references.update({
      add: refs.map((ref) => localMediaReferenceValue(ref).range(ref.from, ref.to)),
      sort: true,
    });
  }
  return {
    references,
    pendingRanges: mergeDirtyRanges([...remaining, ...uncoveredRanges]),
  };
}

function updateLocalMediaIndex(
  value: LocalMediaIndex,
  tr: Transaction,
): LocalMediaIndex {
  if (tr.reconfigured) {
    return buildLocalMediaIndex(tr.state);
  }

  if (!tr.docChanged) {
    // Doc-unchanged tree-progress ticks reconcile ranges the parser reached.
    return reconcilePendingMediaRanges(value, tr.state);
  }

  return measureSync("cm6.mediaIndex.update", () => {
    const oldDirtyRanges = dirtyRangesFromChanges(
      tr.changes,
      (from, to) => expandChangeRangeToLines(tr.startState.doc, from, to),
    );
    const newDirtyRanges = dirtyRangesFromChanges(
      tr.changes,
      (from, to) => expandChangeRangeToLines(tr.state.doc, from, to),
    );
    const oldRefs = collectLocalMediaReferencesInRanges(tr.startState, oldDirtyRanges);
    const removalRanges = mergeDirtyRanges([
      ...newDirtyRanges,
      ...oldRefs.map((ref) => mapReferenceRangeToDirtyRange(ref, tr.state, tr.changes)),
    ]);
    const { refs: newRefs, uncoveredRanges } = measureSync(
      "cm6.mediaIndex.update.collectDirty",
      () => collectCoveredLocalMediaReferences(tr.state, newDirtyRanges),
    );

    let references = value.references.map(tr.changes);
    references = filterLocalMediaReferencesInRanges(references, removalRanges);
    if (newRefs.length > 0) {
      references = references.update({
        add: newRefs.map((ref) => localMediaReferenceValue(ref).range(ref.from, ref.to)),
        sort: true,
      });
    }

    const pendingRanges = mergeDirtyRanges([
      ...mapPendingMediaRanges(value.pendingRanges, tr),
      ...uncoveredRanges,
    ]);
    return reconcilePendingMediaRanges({ references, pendingRanges }, tr.state);
  });
}

export const mediaIndexField = StateField.define<LocalMediaIndex>({
  create(state) {
    return measureSync("cm6.mediaIndex.create", () => buildLocalMediaIndex(state));
  },
  update: updateLocalMediaIndex,
});

export function localMediaReferences(
  index: LocalMediaIndex | null | undefined,
): LocalMediaReference[] {
  if (!index) return [];
  const refs: LocalMediaReference[] = [];
  const cursor = index.references.iter();
  while (cursor.value) {
    refs.push(cursor.value.toReference(cursor.from, cursor.to));
    cursor.next();
  }
  return refs;
}

export function localMediaReferencesInRanges(
  index: LocalMediaIndex | null | undefined,
  ranges: readonly DirtyRange[],
): LocalMediaReference[] {
  if (!index || ranges.length === 0) return [];
  const refs: LocalMediaReference[] = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    index.references.between(range.from, range.to, (from, to, value) => {
      if (!rangeIntersectsDirtyRanges(from, to, [range])) return;
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push(value.toReference(from, to));
    });
  }
  return refs;
}

export function localMediaReferencesForResolvedPaths(
  index: LocalMediaIndex | null | undefined,
  resolvedPaths: ReadonlySet<string>,
): LocalMediaReference[] {
  if (!index || resolvedPaths.size === 0) return [];
  const refs: LocalMediaReference[] = [];
  const seen = new Set<string>();
  const cursor = index.references.iter();
  while (cursor.value) {
    if (resolvedPaths.has(cursor.value.resolvedPath)) {
      const key = `${cursor.from}:${cursor.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(cursor.value.toReference(cursor.from, cursor.to));
      }
    }
    cursor.next();
  }
  return refs;
}

export function localMediaReferenceRangesForResolvedPaths(
  index: LocalMediaIndex | null | undefined,
  resolvedPaths: ReadonlySet<string>,
): DirtyRange[] {
  return localMediaReferencesForResolvedPaths(index, resolvedPaths).map((ref) => ({
    from: ref.from,
    to: ref.to,
  }));
}

export function collectChangedLocalMediaPathsFromIndex(
  index: LocalMediaIndex | null | undefined,
  oldPdfCache: MediaCache,
  newPdfCache: MediaCache,
  oldImgCache: MediaCache,
  newImgCache: MediaCache,
): ReadonlySet<string> {
  if (!index) return EMPTY_CHANGED_MEDIA_PATHS;

  const changedPaths = new Set<string>();
  const checked = new Set<string>();
  const cursor = index.references.iter();
  while (cursor.value) {
    const { cacheKind, resolvedPath } = cursor.value;
    const key = `${cacheKind}:${resolvedPath}`;
    if (!checked.has(key)) {
      checked.add(key);
      const oldCache = cacheKind === "pdf" ? oldPdfCache : oldImgCache;
      const newCache = cacheKind === "pdf" ? newPdfCache : newImgCache;
      if (oldCache !== newCache && oldCache.get(resolvedPath) !== newCache.get(resolvedPath)) {
        changedPaths.add(resolvedPath);
      }
    }
    cursor.next();
  }

  return changedPaths.size > 0 ? changedPaths : EMPTY_CHANGED_MEDIA_PATHS;
}
