import {
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import {
  DOCUMENT_SURFACE_CLASS,
  documentSurfaceClassNames,
} from "../../core/document-surface-classes";
import {
  editorListItemLineClassNamesFromNode,
  type ListTreeNodeLike,
} from "../../core/list-surface";
import {
  clampDocPos,
  expandChangeQueryRange,
  expandRangeToLineBounds,
  forEachOverlappingOrderedRange,
  getMergedRangeCoverage,
  rangesOverlap,
} from "../lib/range-helpers";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { buildDecorations } from "./decoration-core";
import { SyntaxParseScheduler } from "./syntax-parse-scheduler";
import { createSimpleViewPlugin } from "./view-plugin-factories";

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

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const LINE_CLASS_BY_TAG: Readonly<Record<string, string>> = {
  p: DOCUMENT_SURFACE_CLASS.paragraph,
};

const LINE_DECORATION_CACHE = new Map<string, Decoration>();
const LIST_LINE_DECORATION_CACHE = new Map<string, Decoration>();

function sourceLineDecoration(from: number, to: number): Decoration {
  return Decoration.line({
    attributes: {
      "data-source-from": String(from),
      "data-source-to": String(to),
    },
  });
}

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
  const visibleFrom = Math.max(rangeFrom, hiddenFrontmatterVisualEnd(state));
  if (visibleFrom > rangeTo) return [];
  const lineTagMap = new Map<number, string>();
  const items: Range<Decoration>[] = [];
  const semantics = state.field(documentAnalysisField, false);
  const range = { from: visibleFrom, to: rangeTo };

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
          visibleFrom,
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
          visibleFrom,
          rangeTo,
        );
      },
    );
  }

  const treeTagMap = semantics ? TREE_ONLY_TAG_NAME_MAP : TAG_NAME_MAP;
  syntaxTree(state).iterate({
    from: visibleFrom,
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
          visibleFrom,
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
          visibleFrom,
          rangeTo,
        );
      }
    },
  });

  for (const [pos, tagName] of [...lineTagMap.entries()].sort((a, b) => a[0] - b[0])) {
    items.push(lineDecorationFor(tagName).range(pos));
  }

  const firstLine = state.doc.lineAt(visibleFrom);
  const lastLine = state.doc.lineAt(rangeTo);
  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber++) {
    const line = state.doc.line(lineNumber);
    items.push(sourceLineDecoration(line.from, line.to).range(line.from));
  }

  return items;
}

function hiddenFrontmatterVisualEnd(state: EditorState): number {
  const frontmatter = state.field(frontmatterField, false);
  if (!frontmatter || frontmatter.end <= 0) return 0;
  let visualEnd = frontmatter.end;
  while (visualEnd < state.doc.length) {
    const line = state.doc.lineAt(visualEnd);
    if (line.text.trim() !== "") break;
    visualEnd = line.to < state.doc.length ? line.to + 1 : line.to;
  }
  return visualEnd;
}

/**
 * Build a DecorationSet of `Decoration.line` decorations for the lines that
 * CodeMirror currently renders (the viewport expanded to line bounds), adding
 * `data-tag-name` attributes to each covered `cm-line` element.
 *
 * `Decoration.line` must be applied at the line-start position (from).
 * We iterate over every rendered line that falls within each matching node
 * and apply the decoration to each line's start. Lines outside the viewport
 * have no DOM, so decorating them would have no observable effect.
 */
function buildViewportContainerDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const rangeFrom = state.doc.lineAt(view.viewport.from).from;
  const rangeTo = state.doc.lineAt(view.viewport.to).to;
  return buildDecorations(
    collectLineDecorationsInRange(state, rangeFrom, rangeTo),
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
 * Viewport-scoped ViewPlugin that maintains `Decoration.line` decorations
 * for the rendered lines, adding `data-tag-name` attributes to the
 * corresponding `cm-line` DOM elements.
 *
 * Rebuilds are O(visible lines): on doc edits, viewport moves, and syntax
 * tree advancement (background parse progress dispatches tree-changing
 * updates, which re-tags any lines that were rendered from a partial tree).
 *
 * This enables CSS targeting such as:
 *   `.cm-line[data-tag-name="h1"] { ... }`
 */
const containerAttributesViewPlugin = createSimpleViewPlugin(
  buildViewportContainerDecorations,
  {
    shouldUpdate: (update) =>
      update.docChanged ||
      update.viewportChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState),
    spanName: "cm6.containerAttributes",
  },
);

/**
 * Legacy export name kept for render/index.ts. The decoration source is no
 * longer a StateField — container attributes are emitted by the
 * viewport-scoped view plugin this aliases.
 */
export const containerAttributesField: Extension = containerAttributesViewPlugin;

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
  frontmatterField,
  containerAttributePendingDirtyRegionField,
  containerAttributesViewPlugin,
  ViewPlugin.fromClass(ContainerAttributeParsePlugin),
];

export {
  containerAttributePendingDirtyRegionField as _containerAttributePendingDirtyRegionFieldForTest,
};
