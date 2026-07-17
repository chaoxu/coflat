import { syntaxTree } from "@codemirror/language";
import {
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginSpec,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { measureSync } from "../lib/perf";
import { buildDecorations } from "./decoration-core";
import {
  filterDecorationSetInRanges,
  hasProgrammaticDocumentRewrite,
} from "./decoration-lifecycle";
import {
  diffVisibleRanges,
  isPositionInRanges,
  mapVisibleRanges,
  mergeRanges,
  rangeIntersectsRanges,
  snapshotRanges,
  type VisibleRange,
} from "./viewport-diff";

/**
 * Default update predicate for render ViewPlugins.
 *
 * Returns true only for structural changes: docChanged or syntaxTree changed.
 */
export function defaultShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

function collectDecorationStartsInRanges(
  decorations: DecorationSet,
  ranges: readonly VisibleRange[],
  excludeRanges: readonly VisibleRange[] = [],
): ReadonlySet<number> {
  const starts = new Set<number>();
  for (const range of ranges) {
    decorations.between(range.from, range.to, (from) => {
      if (excludeRanges.length > 0 && isPositionInRanges(from, excludeRanges)) {
        return;
      }
      starts.add(from);
    });
  }
  return starts;
}

const NO_SKIP = () => false;

function measurePluginBranch<T>(
  spanName: string | undefined,
  branch: string,
  task: () => T,
): T {
  return spanName ? measureSync(`${spanName}.${branch}`, task) : task();
}

/**
 * Collect function signature for cursor-sensitive view plugins.
 */
export type CursorSensitiveCollectFn = (
  view: EditorView,
  ranges: readonly VisibleRange[],
  skip: (nodeFrom: number) => boolean,
) => Range<Decoration>[];

/**
 * Optional doc-change invalidation callback for cursor-sensitive view plugins.
 */
export type CursorSensitiveDocChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Optional selection/focus invalidation callback for cursor-sensitive view plugins.
 */
export type CursorSensitiveContextChangeRangesFn = (
  update: ViewUpdate,
) => readonly VisibleRange[] | null;

/**
 * Factory for cursor-sensitive ViewPlugins with differential viewport updates.
 */
export function createCursorSensitiveViewPlugin(
  collectFn: CursorSensitiveCollectFn,
  options?: {
    selectionCheck?: (update: ViewUpdate) => boolean;
    contextChangeRanges?: CursorSensitiveContextChangeRangesFn;
    docChangeRanges?: CursorSensitiveDocChangeRangesFn;
    /** How to handle viewport-only updates when no doc/context work is needed. */
    onViewportOnly?: "incremental" | "skip";
    extraRebuildCheck?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
    spanName?: string;
  },
): Extension {
  class CursorSensitivePlugin implements PluginValue {
    decorations!: DecorationSet;
    private coveredRanges!: VisibleRange[];

    constructor(view: EditorView) {
      const items = measurePluginBranch(options?.spanName, "create", () =>
        collectFn(view, view.visibleRanges, NO_SKIP)
      );
      this.decorations = buildDecorations(items);
      this.coveredRanges = snapshotRanges(view.visibleRanges);
    }

    private rebuild(view: EditorView): void {
      const items = measurePluginBranch(options?.spanName, "rebuild", () =>
        collectFn(view, view.visibleRanges, NO_SKIP)
      );
      this.decorations = buildDecorations(items);
      this.coveredRanges = snapshotRanges(view.visibleRanges);
    }

    private updateVisibleRanges(
      view: EditorView,
      baseDecorations: DecorationSet,
      previousCoveredRanges: readonly VisibleRange[],
      dirtyRanges: readonly VisibleRange[],
    ): void {
      const currentVisibleRanges = snapshotRanges(view.visibleRanges);
      const visibleDirtyRanges = mergeRanges(
        dirtyRanges.filter((range) =>
          rangeIntersectsRanges(range.from, range.to, currentVisibleRanges)
        ),
      );
      const staleRanges = diffVisibleRanges(currentVisibleRanges, previousCoveredRanges);
      const missingVisible = diffVisibleRanges(previousCoveredRanges, currentVisibleRanges);
      const rebuildRanges = mergeRanges([...visibleDirtyRanges, ...missingVisible]);
      const filterRanges = mergeRanges([...visibleDirtyRanges, ...staleRanges]);

      let nextDecorations = filterRanges.length > 0
        ? filterDecorationSetInRanges(
            baseDecorations,
            filterRanges,
            (from, to) =>
              rangeIntersectsRanges(from, to, currentVisibleRanges) &&
              !rangeIntersectsRanges(from, to, visibleDirtyRanges),
          )
        : baseDecorations;

      if (rebuildRanges.length > 0) {
        const retainedStarts = collectDecorationStartsInRanges(
          nextDecorations,
          currentVisibleRanges,
          visibleDirtyRanges,
        );
        const skip = (pos: number) => retainedStarts.has(pos);
        const newItems = collectFn(view, rebuildRanges, skip);
        if (newItems.length > 0) {
          nextDecorations = nextDecorations.update({
            add: newItems,
            sort: true,
          });
        }
      }

      this.decorations = nextDecorations;
      this.coveredRanges = currentVisibleRanges;
    }

    private skipViewportOnlyUpdate(): boolean {
      return options?.onViewportOnly === "skip";
    }

    private incrementalViewportUpdate(update: ViewUpdate): void {
      measurePluginBranch(options?.spanName, "viewport", () => {
        this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, []);
      });
    }

    private incrementalDocUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      measurePluginBranch(options?.spanName, "incrementalDoc", () => {
        const mappedCoveredRanges = mapVisibleRanges(this.coveredRanges, update.changes);
        this.updateVisibleRanges(
          update.view,
          this.decorations.map(update.changes),
          mappedCoveredRanges,
          dirtyRanges,
        );
      });
    }

    private incrementalContextUpdate(
      update: ViewUpdate,
      dirtyRanges: readonly VisibleRange[],
    ): void {
      measurePluginBranch(options?.spanName, "incrementalContext", () => {
        this.updateVisibleRanges(update.view, this.decorations, this.coveredRanges, dirtyRanges);
      });
    }

    update(update: ViewUpdate): void {
      if (hasProgrammaticDocumentRewrite(update)) {
        this.rebuild(update.view);
        return;
      }

      const contextDirtyRanges = options?.contextChangeRanges?.(update);
      const selectionNeedsRebuild = contextDirtyRanges === undefined
        ? (options?.selectionCheck ? options.selectionCheck(update) : update.selectionSet)
        : contextDirtyRanges === null;
      const extraNeedsRebuild = options?.extraRebuildCheck?.(update) ?? false;

      if (update.docChanged) {
        const docDirtyRanges = options?.docChangeRanges?.(update);
        let dirtyRanges: readonly VisibleRange[] | null | undefined;
        if (docDirtyRanges === undefined) {
          dirtyRanges = undefined;
        } else if (contextDirtyRanges === undefined || docDirtyRanges === null) {
          dirtyRanges = docDirtyRanges;
        } else if (contextDirtyRanges === null) {
          dirtyRanges = null;
        } else {
          dirtyRanges = mergeRanges([...docDirtyRanges, ...contextDirtyRanges]);
        }
        const needsFullRebuild =
          selectionNeedsRebuild ||
          (contextDirtyRanges === undefined && update.focusChanged) ||
          extraNeedsRebuild ||
          dirtyRanges === null ||
          dirtyRanges === undefined;

        if (needsFullRebuild) {
          this.rebuild(update.view);
          return;
        }

        this.incrementalDocUpdate(update, dirtyRanges as readonly VisibleRange[]);
        return;
      }

      if (
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        extraNeedsRebuild
      ) {
        this.rebuild(update.view);
        return;
      }

      if (contextDirtyRanges !== undefined) {
        if (contextDirtyRanges === null) {
          this.rebuild(update.view);
          return;
        }
        if (contextDirtyRanges.length > 0) {
          this.incrementalContextUpdate(update, contextDirtyRanges);
          return;
        }
        if (update.viewportChanged && !this.skipViewportOnlyUpdate()) {
          this.incrementalContextUpdate(update, contextDirtyRanges);
        }
        return;
      }

      if (selectionNeedsRebuild || update.focusChanged) {
        this.rebuild(update.view);
        return;
      }

      if (update.viewportChanged && !this.skipViewportOnlyUpdate()) {
        this.incrementalViewportUpdate(update);
      }
    }
  }

  return ViewPlugin.fromClass(CursorSensitivePlugin, {
    ...options?.pluginSpec,
    decorations: (value) => value.decorations,
  });
}

/**
 * Factory that creates a CM6 ViewPlugin producing DecorationSet.
 */
export function createSimpleViewPlugin(
  buildFn: (view: EditorView) => DecorationSet,
  options?: {
    shouldUpdate?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
    spanName?: string;
  },
): Extension {
  const shouldUpdate = options?.shouldUpdate ?? defaultShouldUpdate;

  class SimpleViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = measurePluginBranch(options?.spanName, "create", () => buildFn(view));
    }

    update(update: ViewUpdate): void {
      if (shouldUpdate(update)) {
        this.decorations = measurePluginBranch(
          options?.spanName,
          "rebuild",
          () => buildFn(update.view),
        );
      }
    }
  }

  return ViewPlugin.fromClass(SimpleViewPlugin, {
    ...options?.pluginSpec,
    decorations: (value) => value.decorations,
  });
}
