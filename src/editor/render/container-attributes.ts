import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  clampDocPos,
  expandChangeQueryRange,
  expandRangeToLineBounds,
  forEachOverlappingOrderedRange,
  getMergedRangeCoverage,
  rangesOverlap,
} from "../lib/range-helpers";
import { documentAnalysisField } from "../state/document-analysis";
import { buildDecorations } from "./decoration-core";
import { SyntaxParseScheduler } from "./syntax-parse-scheduler";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import {
  editorListItemLineClassNamesFromNode,
  type ListTreeNodeLike,
} from "../../core/list-surface";

/**
 * Maps Lezer syntax node type names to HTML tag names.
 * These become `data-tag-name` attributes on `cm-line` elements,
 * enabling CSS selectors like `[data-tag-name="h1"]`.
 */
const TAG_NAME_MAP: Readonly<Record<string, string>> = {
  ATXHeading1: "h1",
  ATXHeading2: "h2",
  ATXHeading3: "h3",
  ATXHeading4: "h4",
  ATXHeading5: "h5",
  ATXHeading6: "h6",
  BulletList: "ul",
  OrderedList: "ol",
  FencedCode: "code",
  HorizontalRule: "hr",
  FencedDiv: "div",
  Paragraph: "p",
};

const TREE_ONLY_TAG_NAME_MAP: Readonly<Record<string, string>> = {
  BulletList: "ul",
  OrderedList: "ol",
  FencedCode: "code",
  HorizontalRule: "hr",
  Paragraph: "p",
};

const CONTAINER_NODE_TYPES = new Set([...Object.keys(TAG_NAME_MAP), "ListItem"]);
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const LINE_CLASS_BY_TAG: Readonly<Record<string, string>> = {
  p: DOCUMENT_SURFACE_CLASS.paragraph,
};

const LINE_DECORATION_CACHE = new Map<string, Decoration>();
const LIST_LINE_DECORATION_CACHE = new Map<string, Decoration>();

function lineDecorationFor(tagName: string): Decoration {
  const classes = documentSurfaceClassNames(LINE_CLASS_BY_TAG[tagName]);
  const cached = LINE_DECORATION_CACHE.get(tagName);
  if (cached) return cached;
  const decoration = Decoration.line({
    attributes: { "data-tag-name": tagName },
    class: classes || undefined,
  });
  LINE_DECORATION_CACHE.set(tagName, decoration);
  return decoration;
}

function listLineDecorationFor(classNames: readonly string[]): Decoration {
  const classes = documentSurfaceClassNames(...classNames);
  const cached = LIST_LINE_DECORATION_CACHE.get(classes);
  if (cached) return cached;
  const decoration = Decoration.line({ class: classes });
  LIST_LINE_DECORATION_CACHE.set(classes, decoration);
  return decoration;
}

function forEachCoveredLineStart(
  state: EditorState,
  from: number,
  to: number,
  rangeFrom: number,
  rangeTo: number,
  callback: (lineStart: number) => void,
): void {
  if (!rangesOverlap({ from, to }, { from: rangeFrom, to: rangeTo })) return;

  let lineStart = state.doc.lineAt(Math.max(from, rangeFrom)).from;
  const nodeEnd = Math.min(to, rangeTo);

  while (lineStart <= nodeEnd) {
    callback(lineStart);
    const line = state.doc.lineAt(lineStart);
    if (line.to >= nodeEnd) break;
    lineStart = line.to + 1;
  }
}

function assignLineTag(
  lineTagMap: Map<number, string>,
  state: EditorState,
  from: number,
  to: number,
  tagName: string,
  rangeFrom: number,
  rangeTo: number,
): void {
  forEachCoveredLineStart(state, from, to, rangeFrom, rangeTo, (lineStart) => {
    lineTagMap.set(lineStart, tagName);
  });
}

function addListLineDecorations(
  items: Range<Decoration>[],
  state: EditorState,
  from: number,
  to: number,
  classNames: readonly string[],
  rangeFrom: number,
  rangeTo: number,
): void {
  const decoration = listLineDecorationFor(classNames);
  forEachCoveredLineStart(state, from, to, rangeFrom, rangeTo, (lineStart) => {
    items.push(decoration.range(lineStart));
  });
}

function listItemLineClasses(node: { readonly node: ListTreeNodeLike }): readonly string[] {
  return editorListItemLineClassNamesFromNode(node.node).split(" ");
}

function collectLineDecorationsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Range<Decoration>[] {
  const lineTagMap = new Map<number, string>();
  const items: Range<Decoration>[] = [];
  const semantics = state.field(documentAnalysisField, false);
  const range = { from: rangeFrom, to: rangeTo };

  if (semantics) {
    forEachOverlappingOrderedRange(
      semantics.headings,
      range,
      (heading) => {
        const tagName = HEADING_TAGS[heading.level - 1];
        if (!tagName) {
          return;
        }
        assignLineTag(
          lineTagMap,
          state,
          heading.from,
          heading.to,
          tagName,
          rangeFrom,
          rangeTo,
        );
      },
    );

    forEachOverlappingOrderedRange(
      getMergedRangeCoverage(semantics.fencedDivs),
      range,
      (div) => {
        assignLineTag(
          lineTagMap,
          state,
          div.from,
          div.to,
          "div",
          rangeFrom,
          rangeTo,
        );
      },
    );
  }

  const treeTagMap = semantics ? TREE_ONLY_TAG_NAME_MAP : TAG_NAME_MAP;
  syntaxTree(state).iterate({
    from: rangeFrom,
    to: rangeTo,
    enter(node) {
      const tagName = treeTagMap[node.type.name];
      if (tagName) {
        assignLineTag(
          lineTagMap,
          state,
          node.from,
          node.to,
          tagName,
          rangeFrom,
          rangeTo,
        );
      }
      if (node.type.name === "ListItem") {
        addListLineDecorations(
          items,
          state,
          node.from,
          node.to,
          listItemLineClasses(node),
          rangeFrom,
          rangeTo,
        );
      }
    },
  });

  for (const [pos, tagName] of [...lineTagMap.entries()].sort((a, b) => a[0] - b[0])) {
    items.push(lineDecorationFor(tagName).range(pos));
  }

  return items;
}

function buildContainerItemsInRange(
  state: EditorState,
  rangeFrom: number,
  rangeTo: number,
): Range<Decoration>[] {
  return collectLineDecorationsInRange(state, rangeFrom, rangeTo);
}

/**
 * Build a DecorationSet of `Decoration.line` decorations that add
 * `data-tag-name` attributes to each `cm-line` element covered by a
 * block-level syntax node.
 *
 * `Decoration.line` must be applied at the line-start position (from).
 * We iterate over every line that falls within each matching node and
 * apply the decoration to each line's start.
 */
function buildContainerDecorations(state: EditorState): DecorationSet {
  return buildDecorations(
    buildContainerItemsInRange(state, 0, state.doc.length),
  );
}

interface DirtyRegion {
  readonly filterFrom: number;
  readonly filterTo: number;
}

function mergeDirtyRegions(
  a: DirtyRegion | null,
  b: DirtyRegion | null,
): DirtyRegion | null {
  if (!a) return b;
  if (!b) return a;
  return {
    filterFrom: Math.min(a.filterFrom, b.filterFrom),
    filterTo: Math.max(a.filterTo, b.filterTo),
  };
}

function dirtyRegionsEqual(
  a: DirtyRegion | null,
  b: DirtyRegion | null,
): boolean {
  if (a === b) return true;
  return a?.filterFrom === b?.filterFrom && a?.filterTo === b?.filterTo;
}

function mapDirtyRegion(region: DirtyRegion, tr: Transaction): DirtyRegion {
  const mappedFrom = clampDocPos(tr.state.doc, tr.changes.mapPos(region.filterFrom, 1));
  const mappedTo = clampDocPos(
    tr.state.doc,
    Math.max(mappedFrom, tr.changes.mapPos(region.filterTo, -1)),
  );
  const mappedWindow = expandRangeToLineBounds(tr.state.doc, mappedFrom, mappedTo);
  return {
    filterFrom: mappedWindow.from,
    filterTo: mappedWindow.to,
  };
}

function computePendingDirtyRegion(
  tr: Transaction,
): DirtyRegion | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const newWindow = expandChangeQueryRange(tr.state.doc, fromB, toB);
    filterFrom = Math.min(filterFrom, newWindow.from);
    filterTo = Math.max(filterTo, newWindow.to);
  }, true);

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

function expandDirtyRegionWithTree(
  state: EditorState,
  dirty: DirtyRegion,
): DirtyRegion {
  let filterFrom = dirty.filterFrom;
  let filterTo = dirty.filterTo;

  syntaxTree(state).iterate({
    from: dirty.filterFrom,
    to: dirty.filterTo,
    enter(node) {
      if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;
      const nodeWindow = expandRangeToLineBounds(state.doc, node.from, node.to);
      filterFrom = Math.min(filterFrom, nodeWindow.from);
      filterTo = Math.max(filterTo, nodeWindow.to);
    },
  });

  return { filterFrom, filterTo };
}

function computeContainerDirtyRegion(
  tr: Transaction,
): DirtyRegion | null {
  let filterFrom = Number.POSITIVE_INFINITY;
  let filterTo = Number.NEGATIVE_INFINITY;

  const oldTree = syntaxTree(tr.startState);
  const newTree = syntaxTree(tr.state);

  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const oldWindow = expandChangeQueryRange(tr.startState.doc, fromA, toA);
    const newWindow = expandChangeQueryRange(tr.state.doc, fromB, toB);

    filterFrom = Math.min(filterFrom, newWindow.from);
    filterTo = Math.max(filterTo, newWindow.to);

    oldTree.iterate({
      from: oldWindow.from,
      to: oldWindow.to,
      enter(node) {
        if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;

        const mappedFrom = clampDocPos(tr.state.doc, tr.changes.mapPos(node.from, 1));
        const mappedTo = clampDocPos(
          tr.state.doc,
          Math.max(mappedFrom, tr.changes.mapPos(node.to, -1)),
        );
        const mappedWindow = expandRangeToLineBounds(
          tr.state.doc,
          mappedFrom,
          mappedTo,
        );
        filterFrom = Math.min(filterFrom, mappedWindow.from);
        filterTo = Math.max(filterTo, mappedWindow.to);
      },
    });

    newTree.iterate({
      from: newWindow.from,
      to: newWindow.to,
      enter(node) {
        if (!CONTAINER_NODE_TYPES.has(node.type.name)) return;

        const nodeWindow = expandRangeToLineBounds(
          tr.state.doc,
          node.from,
          node.to,
        );
        filterFrom = Math.min(filterFrom, nodeWindow.from);
        filterTo = Math.max(filterTo, nodeWindow.to);
      },
    });
  }, true);

  if (filterFrom > filterTo) return null;
  return { filterFrom, filterTo };
}

function replaceContainerDecorationsInRange(
  value: DecorationSet,
  state: EditorState,
  dirty: DirtyRegion,
): DecorationSet {
  const { filterFrom, filterTo } = dirty;
  const newItems = buildContainerItemsInRange(state, filterFrom, filterTo);

  return value.update({
    filterFrom,
    filterTo,
    filter: () => false,
    add: newItems,
    sort: true,
  });
}

function incrementalContainerUpdate(
  value: DecorationSet,
  tr: Transaction,
): DecorationSet {
  const mapped = value.map(tr.changes);
  const dirty = computeContainerDirtyRegion(tr);
  if (!dirty) return mapped;

  return replaceContainerDecorationsInRange(mapped, tr.state, dirty);
}

const containerAttributePendingDirtyRegionField = StateField.define<DirtyRegion | null>({
  create(state) {
    if (syntaxTreeAvailable(state, state.doc.length)) return null;
    return { filterFrom: 0, filterTo: state.doc.length };
  },

  update(value, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const pendingDirtyRegion = tr.docChanged && value
      ? mapDirtyRegion(value, tr)
      : value;

    if (tr.docChanged) {
      const nextDirtyRegion = mergeDirtyRegions(
        pendingDirtyRegion,
        computePendingDirtyRegion(tr),
      );
      if (
        treeChanged &&
        nextDirtyRegion &&
        syntaxTreeAvailable(tr.state, nextDirtyRegion.filterTo)
      ) {
        return null;
      }

      return nextDirtyRegion;
    }

    if (
      treeChanged &&
      pendingDirtyRegion &&
      syntaxTreeAvailable(tr.state, pendingDirtyRegion.filterTo)
    ) {
      return null;
    }

    return pendingDirtyRegion;
  },

  compare(a, b) {
    return dirtyRegionsEqual(a, b);
  },
});

/**
 * StateField that maintains a DecorationSet of `Decoration.line`
 * decorations for all block-level nodes, adding `data-tag-name`
 * attributes to the corresponding `cm-line` DOM elements.
 *
 * Uses mapped decoration updates for text edits and only rebuilds the
 * container-tag decorations inside the dirty structural span. This keeps
 * typing in large documents from paying a broad full-document rebuild cost
 * while still updating far-reaching block-boundary edits correctly.
 *
 * This enables CSS targeting such as:
 *   `.cm-line[data-tag-name="h1"] { ... }`
 */
export const containerAttributesField = StateField.define<DecorationSet>({
  create(state) {
    return buildContainerDecorations(state);
  },

  update(value, tr) {
    const treeChanged = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const previousPendingDirtyRegion = tr.startState.field(
      containerAttributePendingDirtyRegionField,
      false,
    );
    const nextPendingDirtyRegion = tr.state.field(
      containerAttributePendingDirtyRegionField,
      false,
    );

    if (tr.docChanged) {
      if (!nextPendingDirtyRegion) {
        return incrementalContainerUpdate(value, tr);
      }

      return value.map(tr.changes);
    }

    if (treeChanged) {
      if (previousPendingDirtyRegion && !nextPendingDirtyRegion) {
        return replaceContainerDecorationsInRange(
          value,
          tr.state,
          expandDirtyRegionWithTree(tr.state, previousPendingDirtyRegion),
        );
      }

      if (
        !previousPendingDirtyRegion &&
        syntaxTreeAvailable(tr.state, tr.state.doc.length)
      ) {
        return buildContainerDecorations(tr.state);
      }
    }

    return value;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

class ContainerAttributeParsePlugin {
  private readonly scheduler: SyntaxParseScheduler;
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.scheduler = new SyntaxParseScheduler(view);
    this.schedule();
  }

  update(_update: ViewUpdate): void {
    if (this.destroyed) return;
    if (this.view.state.field(containerAttributePendingDirtyRegionField, false)) {
      this.schedule();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.scheduler.destroy();
  }

  private schedule(): void {
    if (this.destroyed) return;
    const pendingDirtyRegion = this.view.state.field(
      containerAttributePendingDirtyRegionField,
      false,
    );
    if (!pendingDirtyRegion) return;
    this.scheduler.schedule({
      targetTo: pendingDirtyRegion.filterTo,
      isStillNeeded: () => Boolean(
        !this.destroyed &&
        this.view.state.field(containerAttributePendingDirtyRegionField, false),
      ),
    });
  }
}

/** CM6 extension that adds `data-tag-name` attributes to `cm-line` elements. */
export const containerAttributesPlugin: Extension = [
  containerAttributePendingDirtyRegionField,
  containerAttributesField,
  ViewPlugin.fromClass(ContainerAttributeParsePlugin),
];

export { computeContainerDirtyRegion as _computeContainerDirtyRegionForTest };
