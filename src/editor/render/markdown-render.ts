import { syntaxTree } from "@codemirror/language";
import {
  type EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNodeRef, Tree } from "@lezer/common";
import { CSS } from "../../core/constants/css-classes";
import { measureSync } from "../lib/perf";
import { containsRange } from "../lib/range-helpers";
import { computeAnalyzableFrontier } from "../semantics/incremental/engine";
import {
  buildDecorations,
  decorationHidden,
} from "./decoration-core";
import {
  hasProgrammaticDocumentRewrite,
  removeDecorationsInRanges,
} from "./decoration-lifecycle";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  clearLinkDecorationCacheForTest,
  linkDecorationCacheSizeForTest,
  openRenderedLinkAtEvent,
} from "./link-handler";
import {
  addActiveLineTypingSupplements,
  CURSOR_SENSITIVE_NODES,
  MARKDOWN_HANDLERS,
  type MarkdownHandlerContext,
} from "./markdown-render-handlers";
import { createCursorSensitiveViewPlugin } from "./view-plugin-factories";
import {
  mergeRanges,
  normalizeDirtyRange,
  type VisibleRange,
} from "./viewport-diff";

const MARKDOWN_REVEAL_FREEZE_TAIL_MS = 100;

const setMarkdownRevealFrozen = StateEffect.define<boolean>();

/**
 * Pre-drag reveal context for the pointer freeze: while frozen, holds the
 * selection captured when the freeze started (mapped through doc changes);
 * null while unfrozen. Reveal decisions for ranges collected mid-drag (e.g.
 * content scrolled in during an auto-scroll drag) use this snapshot instead of
 * the live drag selection so they match the frozen decorations — parity with
 * the old whole-document field, which left everything untouched while frozen.
 */
const markdownRevealFrozenField = StateField.define<EditorSelection | null>({
  create: () => null,
  update(frozenSelection, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setMarkdownRevealFrozen)) {
        return effect.value ? tr.startState.selection.map(tr.changes) : null;
      }
    }
    return frozenSelection && tr.docChanged
      ? frozenSelection.map(tr.changes)
      : frozenSelection;
  },
});

/** Selection to use for reveal decisions: frozen snapshot while a pointer freeze is active. */
function markdownRevealSelection(state: EditorState): EditorSelection {
  return state.field(markdownRevealFrozenField, false) ?? state.selection;
}

function transactionUnfreezesMarkdownReveal(tr: Transaction): boolean {
  return tr.effects.some((effect) =>
    effect.is(setMarkdownRevealFrozen) && effect.value === false
  );
}

function shouldFreezeMarkdownRevealForPointerTarget(
  target: EventTarget | null,
  view: EditorView,
): boolean {
  if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
    return false;
  }
  const targetElement = target instanceof Element ? target : target.parentElement;
  if (
    targetElement &&
    targetElement.closest(`.${CSS.tableWidget}`)
  ) {
    return false;
  }
  return true;
}

const markdownRevealFreezePlugin: Extension = ViewPlugin.fromClass(class {
  view: EditorView;
  private pointerDownInContent = false;
  private releaseTimer: number | null = null;

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!shouldFreezeMarkdownRevealForPointerTarget(event.target, this.view)) return;
    this.pointerDownInContent = true;
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
    if (!this.view.state.field(markdownRevealFrozenField)) {
      this.view.dispatch({ effects: setMarkdownRevealFrozen.of(true) });
    }
  };

  private readonly onPointerRelease = () => {
    if (!this.pointerDownInContent) return;
    this.pointerDownInContent = false;
    if (this.releaseTimer !== null) {
      window.clearTimeout(this.releaseTimer);
    }
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = null;
      if (!this.view.state.field(markdownRevealFrozenField)) return;
      try {
        this.view.dispatch({ effects: setMarkdownRevealFrozen.of(false) });
      } catch {
        // The view may be destroyed while the release timer is pending.
      }
    }, MARKDOWN_REVEAL_FREEZE_TAIL_MS);
  };

  constructor(view: EditorView) {
    this.view = view;
    view.dom.addEventListener("pointerdown", this.onPointerDown, true);
    window.addEventListener("pointerup", this.onPointerRelease);
    window.addEventListener("pointercancel", this.onPointerRelease);
  }

  destroy() {
    this.view.dom.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointerup", this.onPointerRelease);
    window.removeEventListener("pointercancel", this.onPointerRelease);
    if (this.releaseTimer !== null) window.clearTimeout(this.releaseTimer);
  }
});

function uniqueNodeKey(node: SyntaxNodeRef): string {
  return `${node.name}:${node.from}:${node.to}`;
}

function nodeRangeKey(node: SyntaxNodeRef): string {
  return `${node.from}:${node.to}`;
}

function iterateTreeUnique(
  tree: Tree,
  options: {
    readonly from: number;
    readonly to: number;
    readonly key?: (node: SyntaxNodeRef) => string;
    readonly seen?: Set<string>;
    readonly enter: (node: SyntaxNodeRef) => false | undefined;
  },
): void {
  const seenNodes = options.seen ?? new Set<string>();
  const keyForNode = options.key ?? uniqueNodeKey;
  tree.iterate({
    from: options.from,
    to: options.to,
    enter(node) {
      const key = keyForNode(node);
      if (seenNodes.has(key)) return undefined;
      seenNodes.add(key);
      return options.enter(node);
    },
  });
}

function mapNodeRange(
  changes: Transaction["changes"],
  state: EditorState,
  from: number,
  to: number,
): VisibleRange {
  return normalizeDirtyRange(
    changes.mapPos(from, 1),
    changes.mapPos(to, -1),
    state.doc.length,
  );
}

function collectMarkdownDirtyRangesInState(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
  pushRange: (from: number, to: number) => void,
): void {
  // Plain syntaxTree: interactive paths must never force a whole-document
  // parse; the viewport plugin re-renders on tree progress instead.
  const tree = syntaxTree(state);
  const seenRanges = new Set<string>();
  const pushUniqueRange = (from: number, to: number) => {
    const key = `${from}:${to}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);
    pushRange(from, to);
  };

  iterateTreeUnique(tree, {
    from: rangeFrom,
    to: rangeTo,
    key: nodeRangeKey,
    enter(node) {
      if (MARKDOWN_HANDLERS.has(node.name)) {
        pushUniqueRange(node.from, node.to);
      }
      return undefined;
    },
  });

  const positions = rangeFrom === rangeTo ? [rangeFrom] : [rangeFrom, rangeTo];
  for (const pos of positions) {
    const clampedPos = Math.max(0, Math.min(pos, state.doc.length));
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(clampedPos, side);
      while (true) {
        if (MARKDOWN_HANDLERS.has(node.name)) {
          pushUniqueRange(node.from, node.to);
        }
        const parent = node.parent;
        if (!parent) break;
        node = parent;
      }
    }
  }
}

interface CursorContextEntry extends VisibleRange {
  readonly key: string;
}

interface CursorContextSnapshot {
  readonly key: string;
  readonly entries: readonly CursorContextEntry[];
}

function collectCursorContextSnapshot(
  state: EditorState,
  focused = true,
): CursorContextSnapshot {
  if (!focused) {
    return { key: "", entries: [] };
  }

  const { from, to } = state.selection.main;
  const tree = syntaxTree(state);
  const entriesByKey = new Map<string, CursorContextEntry>();

  const positions = from === to ? [from] : [from, to];
  for (const pos of positions) {
    for (const side of [1, -1] as const) {
      let node = tree.resolveInner(pos, side);
      while (node.parent) {
        if (
          CURSOR_SENSITIVE_NODES.has(node.name) &&
          containsRange(node, { from, to })
        ) {
          const key = `${node.name}:${node.from}:${node.to}`;
          if (!entriesByKey.has(key)) {
            entriesByKey.set(key, { key, from: node.from, to: node.to });
          }
        }
        node = node.parent;
      }
    }
  }

  const entries = [...entriesByKey.values()].sort((a, b) =>
    a.from - b.from || a.to - b.to || a.key.localeCompare(b.key)
  );
  return {
    key: entries.length === 0
      ? ""
      : entries.length === 1
        ? entries[0].key
        : entries.map((entry) => entry.key).join("|"),
    entries,
  };
}

interface MarkdownContextRangeCacheEntry {
  readonly startState: EditorState;
  readonly startFocused: boolean;
  readonly endFocused: boolean;
  readonly result: readonly VisibleRange[];
}

/**
 * Shared per-state-pair cache: the residual line-break field (transaction
 * path) and the view plugin (ViewUpdate path) request the same computation
 * for one dispatch; keying on (startState, state, focus) lets them share a
 * single tree walk instead of caching per Transaction and per ViewUpdate.
 */
const markdownContextRangeCache = new WeakMap<EditorState, MarkdownContextRangeCacheEntry[]>();

function computeMarkdownContextChangeRangesBetween(
  startState: EditorState,
  state: EditorState,
  changes: Transaction["changes"],
  startFocused: boolean,
  endFocused: boolean,
): readonly VisibleRange[] {
  const cachedEntries = markdownContextRangeCache.get(state);
  const hit = cachedEntries?.find((entry) =>
    entry.startState === startState
    && entry.startFocused === startFocused
    && entry.endFocused === endFocused
  );
  if (hit) return hit.result;
  const result = computeMarkdownContextChangeRangesBetweenUncached(
    startState,
    state,
    changes,
    startFocused,
    endFocused,
  );
  const entry = { startState, startFocused, endFocused, result };
  if (cachedEntries) cachedEntries.push(entry);
  else markdownContextRangeCache.set(state, [entry]);
  return result;
}

function computeMarkdownContextChangeRangesBetweenUncached(
  startState: EditorState,
  state: EditorState,
  changes: Transaction["changes"],
  startFocused: boolean,
  endFocused: boolean,
): readonly VisibleRange[] {
  const startContext = collectCursorContextSnapshot(startState, startFocused);
  const endContext = collectCursorContextSnapshot(state, endFocused);

  if (startContext.key === endContext.key) {
    return [];
  }

  const nextEntries = new Map(endContext.entries.map((entry) => [entry.key, entry] as const));
  const dirtyRanges: VisibleRange[] = [];

  for (const entry of startContext.entries) {
    if (!nextEntries.has(entry.key)) {
      dirtyRanges.push(mapNodeRange(changes, state, entry.from, entry.to));
    }
  }

  const previousKeys = new Set(startContext.entries.map((entry) => entry.key));
  for (const entry of endContext.entries) {
    if (!previousKeys.has(entry.key)) {
      dirtyRanges.push(normalizeDirtyRange(entry.from, entry.to, state.doc.length));
    }
  }

  return mergeRanges(dirtyRanges);
}

function stateFocus(state: EditorState): boolean {
  return state.field(editorFocusField, false) ?? false;
}

/**
 * Structural view over the shape Transaction and ViewUpdate share — the state
 * pair plus the change set between them. Both satisfy it, so the residual
 * StateField (transaction path) and the view plugin (ViewUpdate path) share
 * one implementation of the editorFocusField-based range computations below.
 */
type MarkdownStateTransition = Pick<Transaction, "startState" | "state" | "changes">;

/**
 * editorFocusField-based context ranges for the production plugin and field
 * (#579 narrowing: selection/focus changes dirty only the cursor-sensitive
 * nodes whose reveal state flips).
 *
 * Reveal state must key off the same focus source as the collect pass
 * (editorFocusField, kept in sync by focusTracker), not the raw
 * update.focusChanged/hasFocus signal: the plugin is constructed before the
 * view gains focus, and the focusEffect transaction is what flips reveal
 * semantics.
 */
export function computeMarkdownContextChangeRangesForTransition(
  transition: MarkdownStateTransition,
): readonly VisibleRange[] {
  return computeMarkdownContextChangeRangesBetween(
    transition.startState,
    transition.state,
    transition.changes,
    stateFocus(transition.startState),
    stateFocus(transition.state),
  );
}

/**
 * Return a key identifying all cursor-sensitive nodes that contain the
 * primary selection. Changes in this key mean the cursor crossed a
 * node boundary that affects marker visibility.
 *
 * Checks both resolve directions at each selection endpoint to handle
 * inclusive-end boundaries (cursorInRange uses pos <= node.to).
 */
export function cursorContextKey(state: EditorState): string {
  return collectCursorContextSnapshot(state).key;
}

/**
 * Dirty-range narrowing for markdown doc changes (#823).
 *
 * Expands literal edits to any markdown-rendered nodes that overlap the change
 * in the old or new tree so mapped decorations outside those fragments stay
 * valid, and merges in any local cursor/focus context changes for the same
 * transaction.
 */
const NO_SEED_RANGES: readonly VisibleRange[] = [];

interface MarkdownDocChangeRangeCacheEntry {
  readonly startState: EditorState;
  readonly seedRanges: readonly VisibleRange[];
  readonly result: readonly VisibleRange[];
}

/**
 * Shared per-state-pair cache (see markdownContextRangeCache): seeds are
 * matched by identity, which holds because they come from the context cache
 * above or the NO_SEED_RANGES constant.
 */
const markdownDocChangeRangeCache = new WeakMap<EditorState, MarkdownDocChangeRangeCacheEntry[]>();

function computeMarkdownDocChangeRangesBetween(
  startState: EditorState,
  state: EditorState,
  changes: Transaction["changes"],
  seedRanges: readonly VisibleRange[],
): readonly VisibleRange[] {
  const cachedEntries = markdownDocChangeRangeCache.get(state);
  const hit = cachedEntries?.find((entry) =>
    entry.startState === startState && entry.seedRanges === seedRanges
  );
  if (hit) return hit.result;
  const result = computeMarkdownDocChangeRangesBetweenUncached(
    startState,
    state,
    changes,
    seedRanges,
  );
  const entry = { startState, seedRanges, result };
  if (cachedEntries) cachedEntries.push(entry);
  else markdownDocChangeRangeCache.set(state, [entry]);
  return result;
}

function computeMarkdownDocChangeRangesBetweenUncached(
  startState: EditorState,
  state: EditorState,
  changes: Transaction["changes"],
  seedRanges: readonly VisibleRange[],
): readonly VisibleRange[] {
  const dirtyRanges = [...seedRanges];
  const pushRange = (from: number, to: number) => {
    dirtyRanges.push(normalizeDirtyRange(from, to, state.doc.length));
  };

  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    collectMarkdownDirtyRangesInState(startState, fromA, toA, (nodeFrom, nodeTo) => {
      dirtyRanges.push(mapNodeRange(changes, state, nodeFrom, nodeTo));
    });
    collectMarkdownDirtyRangesInState(state, fromB, toB, pushRange);
  });

  return mergeRanges(dirtyRanges);
}

function markdownTransitionNeedsContextMerge(
  transition: MarkdownStateTransition,
): boolean {
  return (
    stateFocus(transition.startState) !== stateFocus(transition.state) ||
    !transition.state.selection.eq(transition.startState.selection)
  );
}

/**
 * editorFocusField-based doc-change dirty ranges for the plugin and field
 * (#823): expands literal edits to the markdown nodes they overlap and merges
 * in cursor/focus context changes from the same transaction.
 */
export function computeMarkdownDocChangeRangesForTransition(
  transition: MarkdownStateTransition,
): readonly VisibleRange[] | null {
  return computeMarkdownDocChangeRangesBetween(
    transition.startState,
    transition.state,
    transition.changes,
    markdownTransitionNeedsContextMerge(transition)
      ? computeMarkdownContextChangeRangesForTransition(transition)
      : NO_SEED_RANGES,
  );
}

/**
 * Collect markdown decoration ranges (headings, emphasis, links, etc.).
 *
 * Dispatches each node to its registered handler via MARKDOWN_HANDLERS.
 * Each handler has per-type semantics: some always apply styles, some
 * toggle marker visibility, some skip children entirely.
 *
 * Incremental callers pass `skip(node.from)` for retained boundary nodes.
 * Markdown applies that only to the node itself and still walks children so
 * local rebuilds can update nested dirty descendants without duplicating the
 * parent decorations.
 */
function collectMarkdownItemsForState(
  state: EditorState,
  focused: boolean,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  const ctx: MarkdownHandlerContext = {
    state,
    focused,
    // Injection point for the pointer-freeze parity: while frozen, handlers
    // decide reveal from the pre-drag selection snapshot, so ranges collected
    // mid-drag render like the frozen ones instead of the live drag selection.
    revealSelection: markdownRevealSelection(state),
    items: [],
    cursorInHeading: false,
  };
  const tree = syntaxTree(state);
  const seenNodes = new Set<string>();

  for (const { from, to } of ranges) {
    iterateTreeUnique(tree, {
      from,
      to,
      seen: seenNodes,
      enter(node) {
        const handler = MARKDOWN_HANDLERS.get(node.name);
        if (!handler) return undefined;
        if (skip(node.from) && node.from < from) {
          return undefined;
        }
        return handler.handle(node, ctx) === false ? false : undefined;
      },
    });
  }
  addActiveLineTypingSupplements(ctx, ranges);

  return ctx.items;
}

/**
 * True for hide replacements that span a line break (the HardBreak node covers
 * its trailing newline). CM6 forbids ViewPlugins from providing replace
 * decorations that cross line breaks, so these stay in a residual StateField.
 */
function isLineBreakCrossingHide(
  state: EditorState,
  item: Range<Decoration>,
): boolean {
  return item.value === decorationHidden &&
    item.to > state.doc.lineAt(item.from).to;
}

function collectMarkdownItems(
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
): Range<Decoration>[] {
  return collectMarkdownItemsForState(view.state, stateFocus(view.state), ranges, skip)
    .filter((item) => !isLineBreakCrossingHide(view.state, item));
}

function collectHardBreakSpans(
  state: EditorState,
  ranges: readonly VisibleRange[],
): VisibleRange[] {
  const tree = syntaxTree(state);
  const spans: VisibleRange[] = [];
  const seen = new Set<number>();
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "HardBreak") return undefined;
        if (!seen.has(node.from)) {
          seen.add(node.from);
          spans.push({ from: node.from, to: node.to });
        }
        return false;
      },
    });
  }
  return spans;
}

/**
 * Collect only the line-break-crossing hides (HardBreak) within the given
 * ranges. Walking the handler pipeline from each HardBreak span keeps the
 * revealed-ancestor skip semantics (e.g. cursor inside an Emphasis containing
 * the break) identical to the main viewport collection.
 */
function collectMarkdownLineBreakItems(
  state: EditorState,
  ranges: readonly VisibleRange[],
): Range<Decoration>[] {
  const spans = collectHardBreakSpans(state, ranges);
  if (spans.length === 0) return [];
  return collectMarkdownItemsForState(state, stateFocus(state), spans, () => false)
    .filter((item) => isLineBreakCrossingHide(state, item));
}

function buildMarkdownLineBreakDecorations(state: EditorState): DecorationSet {
  return buildDecorations(
    collectMarkdownLineBreakItems(state, [{ from: 0, to: state.doc.length }]),
  );
}

export { collectMarkdownItems as _collectMarkdownItemsForTest, markdownTransitionNeedsContextMerge as _markdownTransitionNeedsContextMergeForTest };
export function _clearLinkDecorationCacheForTest(): void {
  clearLinkDecorationCacheForTest();
}
export function _linkDecorationCacheSizeForTest(): number {
  return linkDecorationCacheSizeForTest();
}

interface MarkdownLineBreakFieldValue {
  readonly decorations: DecorationSet;
  /** Parse frontier the HardBreak collection has covered so far. */
  readonly frontier: number;
}

function markdownParseFrontier(state: EditorState): number {
  return computeAnalyzableFrontier(state.doc.length, syntaxTree(state));
}

function buildMarkdownLineBreakValue(state: EditorState): MarkdownLineBreakFieldValue {
  return {
    decorations: buildMarkdownLineBreakDecorations(state),
    frontier: markdownParseFrontier(state),
  };
}

function applyMarkdownLineBreakDirtyRanges(
  decorations: DecorationSet,
  state: EditorState,
  dirtyRanges: readonly VisibleRange[],
): DecorationSet {
  const next = removeDecorationsInRanges(decorations, dirtyRanges);
  const items = collectMarkdownLineBreakItems(state, dirtyRanges);
  return items.length === 0 ? next : next.update({ add: items, sort: true });
}

function updateMarkdownLineBreakValue(
  value: MarkdownLineBreakFieldValue,
  tr: Transaction,
): MarkdownLineBreakFieldValue {
  if (hasProgrammaticDocumentRewrite(tr) || transactionUnfreezesMarkdownReveal(tr)) {
    return buildMarkdownLineBreakValue(tr.state);
  }

  const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
  const frozen = Boolean(tr.state.field(markdownRevealFrozenField, false));

  if (!tr.docChanged) {
    const contextRanges = frozen
      ? NO_SEED_RANGES
      : computeMarkdownContextChangeRangesForTransition(tr);
    if (treeChanged) {
      const newFrontier = markdownParseFrontier(tr.state);
      if (contextRanges.length > 0 || newFrontier <= value.frontier) {
        // Context changes coinciding with parse progress are rare, and a
        // frontier that failed to advance means the tree was replaced rather
        // than extended; both keep the previous full-rebuild behavior.
        return buildMarkdownLineBreakValue(tr.state);
      }
      // Doc-unchanged parse progress is prefix-stable: only the newly parsed
      // window can contain HardBreaks that were not collected yet.
      const delta = normalizeDirtyRange(value.frontier, newFrontier, tr.state.doc.length);
      let decorations = removeDecorationsInRanges(value.decorations, [delta]);
      // Breaks ending exactly at the old frontier were fully parsed before and
      // survive the removal above; drop their re-collected twins.
      const items = collectMarkdownLineBreakItems(tr.state, [delta])
        .filter((item) => item.to > value.frontier);
      if (items.length > 0) {
        decorations = decorations.update({ add: items, sort: true });
      }
      return { decorations, frontier: newFrontier };
    }
    if (contextRanges.length === 0) return value;
    return {
      decorations: applyMarkdownLineBreakDirtyRanges(
        value.decorations,
        tr.state,
        contextRanges,
      ),
      frontier: value.frontier,
    };
  }

  // Doc changed: mapped decorations can sit beyond the new parse frontier, so
  // keep the smaller of the mapped frontier and the parsed prefix — the
  // progress path above re-validates anything in between on later ticks.
  const frontier = Math.min(
    tr.changes.mapPos(value.frontier, -1),
    markdownParseFrontier(tr.state),
  );
  if (
    !treeChanged &&
    (frozen || computeMarkdownContextChangeRangesForTransition(tr).length === 0)
  ) {
    return { decorations: value.decorations.map(tr.changes), frontier };
  }
  const dirtyRanges = computeMarkdownDocChangeRangesForTransition(tr);
  if (dirtyRanges === null) {
    return buildMarkdownLineBreakValue(tr.state);
  }
  if (dirtyRanges.length === 0) {
    return { decorations: value.decorations.map(tr.changes), frontier };
  }
  return {
    decorations: applyMarkdownLineBreakDirtyRanges(
      value.decorations.map(tr.changes),
      tr.state,
      dirtyRanges,
    ),
    frontier,
  };
}

/**
 * Residual StateField for the HardBreak hides only: replace decorations that
 * cross line breaks may not come from a ViewPlugin, so they keep the previous
 * StateField substrate while everything else moved to the viewport-scoped
 * plugin below. The value tracks the parse frontier already collected so
 * doc-unchanged tree-progress ticks only scan the newly parsed window instead
 * of rebuilding over the whole document.
 */
const markdownLineBreakHideField = StateField.define<MarkdownLineBreakFieldValue>({
  create(state) {
    return measureSync(
      "cm6.markdownRender.lineBreak.create",
      () => buildMarkdownLineBreakValue(state),
    );
  },
  update(value, tr) {
    return measureSync(
      "cm6.markdownRender.lineBreak.update",
      () => updateMarkdownLineBreakValue(value, tr),
    );
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

function markdownPluginContextChangeRanges(
  update: ViewUpdate,
): readonly VisibleRange[] {
  if (update.state.field(markdownRevealFrozenField, false)) return [];
  return computeMarkdownContextChangeRangesForTransition(update);
}

/**
 * Viewport-scoped markdown decorations (#579/#823 predicates, now live).
 *
 * Builds only view.visibleRanges, patches newly visible fragments on scroll,
 * applies cursor-context and doc-change dirty ranges incrementally, and does a
 * viewport-sized (not whole-document) rebuild on tree progress and on
 * pointer-freeze release.
 */
const markdownViewPlugin = createCursorSensitiveViewPlugin(collectMarkdownItems, {
  contextChangeRanges: markdownPluginContextChangeRanges,
  docChangeRanges: computeMarkdownDocChangeRangesForTransition,
  extraRebuildCheck: (update) =>
    update.transactions.some(transactionUnfreezesMarkdownReveal),
  spanName: "cm6.markdownRender",
});

const renderedLinkEventHandlers = EditorView.domEventHandlers({
  click: openRenderedLinkAtEvent,
});

/** CM6 extension that provides Typora-style rendering for standard markdown. */
export const markdownRenderPlugin: Extension = [
  editorFocusField,
  focusTracker,
  markdownRevealFrozenField,
  markdownRevealFreezePlugin,
  markdownLineBreakHideField,
  markdownViewPlugin,
  renderedLinkEventHandlers,
];

export const _setMarkdownRevealFrozenForTest = setMarkdownRevealFrozen;
