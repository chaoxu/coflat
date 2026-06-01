/**
 * Document folding for the editor.
 *
 * Collapses everything under a heading until the next heading of
 * equal or higher level, and semantic fenced blocks under their header.
 * Fold toggles appear inline next to headings and block headers
 * (not in a separate gutter column).
 */

import {
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
  keymap,
} from "@codemirror/view";
import {
  foldService,
  foldKeymap,
  foldEffect,
  unfoldEffect,
  foldedRanges,
} from "@codemirror/language";
import { isCollapsibleBlockType } from "../core/constants/block-manifest";
import { buildDecorations, RenderWidget } from "./render/render-core";
import type { FencedDivSemantics, HeadingSemantics } from "./semantics/document";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "./state/document-analysis";

type FoldKind = "section" | "block";

interface FoldSection {
  readonly lineFrom: number;
  readonly foldFrom: number;
  readonly foldTo: number;
  readonly kind: FoldKind;
  readonly level: number;
}

interface HeadingFoldSection extends FoldSection {
  readonly kind: "section";
  readonly headingFrom: number;
}

interface BlockFoldSection extends FoldSection {
  readonly kind: "block";
}

interface HeadingFoldState {
  readonly headings: readonly HeadingSemantics[];
  readonly blockSections: readonly BlockFoldSection[];
  readonly boundaryIndices: readonly (number | null)[];
  readonly sectionsByHeadingIndex: readonly (HeadingFoldSection | null)[];
  readonly foldableByLineFrom: ReadonlyMap<number, FoldSection>;
  readonly decorations: DecorationSet;
}

interface ActiveFoldRailState {
  readonly section: FoldSection | null;
  readonly decorations: DecorationSet;
}

function buildFoldableByLineFrom(
  sections: readonly FoldSection[],
): ReadonlyMap<number, FoldSection> {
  return new Map(sections.map((section) => [section.lineFrom, section]));
}

function allFoldSections(state: HeadingFoldState): readonly FoldSection[] {
  return [
    ...collectSections(state.sectionsByHeadingIndex),
    ...state.blockSections,
  ];
}

function sameFoldSection(left: FoldSection | null, right: FoldSection | null): boolean {
  return left === right || (
    left !== null
    && right !== null
    && left.kind === right.kind
    && left.lineFrom === right.lineFrom
    && left.foldFrom === right.foldFrom
    && left.foldTo === right.foldTo
    && left.level === right.level
  );
}

function foldToBeforeHeading(state: EditorState, headingFrom: number): number {
  const line = state.doc.lineAt(headingFrom);
  return line.from > 0 ? line.from - 1 : line.from;
}

function buildHeadingFoldSections(
  state: EditorState,
  headings: readonly HeadingSemantics[],
  boundaryIndices: readonly (number | null)[],
): readonly (HeadingFoldSection | null)[] {
  if (headings.length === 0) return [];
  return headings.map((_, index) =>
    createHeadingFoldSection(state, headings, boundaryIndices[index], index)
  );
}

function collectSections(
  sectionsByHeadingIndex: readonly (HeadingFoldSection | null)[],
): readonly HeadingFoldSection[] {
  return sectionsByHeadingIndex.filter(
    (section): section is HeadingFoldSection => section !== null,
  );
}

function buildHeadingBoundaryIndices(
  headings: readonly HeadingSemantics[],
): readonly (number | null)[] {
  const nextHeadingIndexByLevel: Array<number | undefined> = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const boundaryIndices: Array<number | null> = new Array(headings.length);

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    let nextBoundaryIndex: number | null = null;

    for (let level = 1; level <= heading.level; level++) {
      const candidate = nextHeadingIndexByLevel[level];
      if (candidate !== undefined && (
        nextBoundaryIndex === null || candidate < nextBoundaryIndex
      )) {
        nextBoundaryIndex = candidate;
      }
    }

    boundaryIndices[index] = nextBoundaryIndex;
    nextHeadingIndexByLevel[heading.level] = index;
  }

  return boundaryIndices;
}

function createHeadingFoldSection(
  state: EditorState,
  headings: readonly HeadingSemantics[],
  boundaryIndex: number | null,
  headingIndex: number,
): HeadingFoldSection | null {
  const heading = headings[headingIndex];
  const line = state.doc.lineAt(heading.to);
  const foldFrom = line.to;
  const foldTo = boundaryIndex === null
    ? state.doc.length
    : foldToBeforeHeading(state, headings[boundaryIndex].from);

  return foldTo > foldFrom
    ? {
        kind: "section",
        lineFrom: heading.from,
        headingFrom: heading.from,
        foldFrom,
        foldTo,
        level: heading.level,
      }
    : null;
}

function createBlockFoldSection(
  state: EditorState,
  div: FencedDivSemantics,
): BlockFoldSection | null {
  const blockType = div.primaryClass?.toLowerCase();
  if (
    !isCollapsibleBlockType(blockType)
    || div.singleLine
    || div.isSelfClosing
    || div.closeFenceFrom < 0
    || div.closeFenceTo <= div.openFenceTo
  ) {
    return null;
  }

  const openLine = state.doc.lineAt(div.openFenceFrom);
  const closeLine = state.doc.lineAt(div.closeFenceTo);
  const foldFrom = openLine.to;
  const foldTo = closeLine.to;

  return foldTo > foldFrom
    ? {
        kind: "block",
        lineFrom: openLine.from,
        foldFrom,
        foldTo,
        level: 0,
      }
    : null;
}

function buildBlockFoldSections(
  state: EditorState,
  divs: readonly FencedDivSemantics[],
): readonly BlockFoldSection[] {
  const sections: BlockFoldSection[] = [];
  for (const div of divs) {
    const section = createBlockFoldSection(state, div);
    if (section) sections.push(section);
  }
  return sections;
}

function sameHeadingTopology(
  before: readonly HeadingSemantics[],
  after: readonly HeadingSemantics[],
): boolean {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index++) {
    if (before[index].level !== after[index].level) {
      return false;
    }
  }
  return true;
}

function findChangedHeadingIndices(
  before: readonly HeadingSemantics[],
  after: readonly HeadingSemantics[],
): readonly number[] {
  const changed: number[] = [];
  for (let index = 0; index < before.length; index++) {
    if (
      before[index].from !== after[index].from
      || before[index].to !== after[index].to
    ) {
      changed.push(index);
    }
  }
  return changed;
}

function findAffectedHeadingIndices(
  boundaryIndices: readonly (number | null)[],
  changedHeadingIndices: readonly number[],
  docLengthChanged: boolean,
): readonly number[] {
  if (boundaryIndices.length === 0) return [];

  const changed = new Set(changedHeadingIndices);
  const affected: number[] = [];

  for (let index = 0; index < boundaryIndices.length; index++) {
    const boundaryIndex = boundaryIndices[index];
    if (
      changed.has(index)
      || (boundaryIndex === null ? docLengthChanged : changed.has(boundaryIndex))
    ) {
      affected.push(index);
    }
  }

  return affected;
}

function sameHeadingFoldSection(
  left: HeadingFoldSection | null,
  right: HeadingFoldSection | null,
): boolean {
  return left === right || (
    left !== null
    && right !== null
    && left.kind === right.kind
    && left.lineFrom === right.lineFrom
    && left.headingFrom === right.headingFrom
    && left.foldFrom === right.foldFrom
    && left.foldTo === right.foldTo
    && left.level === right.level
  );
}

/**
 * Fold service that defines foldable ranges for ATX headings.
 *
 * For a heading at level N, the fold range extends from the end of the
 * heading line to just before the next heading of level <= N (or end of doc).
 */
const headingFoldService = foldService.of((state, lineStart, _lineEnd) => {
  const foldState = state.field(headingFoldField, false);
  const section = foldState?.foldableByLineFrom.get(lineStart);
  return section ? { from: section.foldFrom, to: section.foldTo } : null;
});

/** Widget that renders a fold/unfold toggle inline with a heading or block. */
class FoldToggleWidget extends RenderWidget {
  constructor(
    private readonly pos: number,
    private readonly folded: boolean,
    private readonly level: number,
    private readonly kind: FoldKind,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    const classes = [
      "cf-fold-toggle",
      this.kind === "section" ? `cf-fold-h${this.level}` : "cf-fold-block",
    ];
    if (this.folded) classes.push("cf-fold-toggle-folded");
    span.className = classes.join(" ");
    span.textContent = this.folded ? "▶" : "▼";
    span.dataset.cfFoldLineFrom = String(this.pos);
    span.setAttribute("role", "button");
    const labelTarget = this.kind === "section" ? "section" : "block";
    span.setAttribute(
      "aria-label",
      this.folded ? `Unfold ${labelTarget}` : `Fold ${labelTarget}`,
    );

    const pos = this.pos;
    const showFoldRail = () => {
      setActiveFoldRail(view, findFoldSectionAtLineFrom(view.state, pos));
    };
    span.addEventListener("mouseenter", showFoldRail);
    span.addEventListener("mousemove", showFoldRail);
    span.addEventListener("mouseleave", () => {
      setActiveFoldRail(view, null);
    });
    span.addEventListener("mousedown", (e) => {
      try {
        e.preventDefault();
        e.stopPropagation();
        // Toggle fold directly without moving the cursor.
        // Query fold services registered on the state to get the fold range.
        const line = view.state.doc.lineAt(pos);
        let range: { from: number; to: number } | null = null;
        for (const service of view.state.facet(foldService)) {
          range = service(view.state, line.from, line.to);
          if (range) break;
        }
        if (range) {
          let alreadyFolded = false;
          foldedRanges(view.state).between(range.from, range.from + 1, () => {
            alreadyFolded = true;
          });
          if (alreadyFolded) {
            view.dispatch({ effects: unfoldEffect.of({ from: range.from, to: range.to }) });
          } else {
            view.dispatch({ effects: foldEffect.of({ from: range.from, to: range.to }) });
          }
        }
      } catch (err: unknown) {
        console.error("[heading-fold] mousedown handler failed", err);
      }
    });

    return span;
  }

  eq(other: FoldToggleWidget): boolean {
    return this.pos === other.pos
      && this.folded === other.folded
      && this.level === other.level
      && this.kind === other.kind;
  }
}

/** Build fold toggle decorations for all foldable headings and blocks. */
function buildFoldToggleItems(
  state: EditorState,
  sections: readonly FoldSection[],
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const folded = foldedRanges(state);

  for (const section of sections) {
    let isFolded = false;
    folded.between(section.foldFrom, section.foldFrom + 1, () => {
      isFolded = true;
    });

    const widget = new FoldToggleWidget(
      section.lineFrom,
      isFolded,
      section.level,
      section.kind,
    );
    items.push(
      Decoration.line({ class: "cf-fold-line" }).range(section.lineFrom),
    );
    items.push(
      Decoration.widget({ widget, side: -1 }).range(section.lineFrom),
    );
  }

  return items;
}

function buildFoldToggles(
  state: EditorState,
  sections: readonly FoldSection[],
): DecorationSet {
  if (sections.length === 0) return Decoration.none;
  const items = buildFoldToggleItems(state, sections);
  return buildDecorations(items);
}

function buildFoldRailDecorations(
  state: EditorState,
  section: FoldSection | null,
): DecorationSet {
  if (!section || section.foldTo <= section.foldFrom || section.foldFrom >= state.doc.length) {
    return Decoration.none;
  }

  const items: Range<Decoration>[] = [];
  items.push(
    Decoration.line({ class: "cf-fold-rail-heading-active" }).range(section.lineFrom),
  );
  const firstBodyPos = Math.min(section.foldFrom + 1, state.doc.length);
  const firstLine = state.doc.lineAt(firstBodyPos);
  const lastLine = state.doc.lineAt(Math.min(section.foldTo, state.doc.length));
  const className = [
    "cf-fold-rail-line",
    `cf-fold-rail-line-${section.kind}`,
    section.kind === "section" ? `cf-fold-rail-h${section.level}` : "",
  ].filter(Boolean).join(" ");

  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber++) {
    items.push(Decoration.line({ class: className }).range(state.doc.line(lineNumber).from));
  }

  return buildDecorations(items);
}

function activeFoldRailState(
  state: EditorState,
  section: FoldSection | null,
): ActiveFoldRailState {
  return {
    section,
    decorations: buildFoldRailDecorations(state, section),
  };
}

const setActiveFoldRailEffect = StateEffect.define<FoldSection | null>();

const activeFoldRailField = StateField.define<ActiveFoldRailState>({
  create(state) {
    return activeFoldRailState(state, null);
  },
  update(value, tr) {
    let nextSection = tr.docChanged ? null : value.section;

    for (const effect of tr.effects) {
      if (effect.is(setActiveFoldRailEffect)) {
        nextSection = effect.value;
      }
    }

    if (sameFoldSection(value.section, nextSection) && !tr.docChanged) {
      return value;
    }

    return activeFoldRailState(tr.state, nextSection);
  },
  compare(a, b) {
    return sameFoldSection(a.section, b.section)
      && a.decorations === b.decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  },
});

function findFoldSectionAtLineFrom(
  state: EditorState,
  lineFrom: number,
): FoldSection | null {
  return state.field(headingFoldField, false)?.foldableByLineFrom.get(lineFrom) ?? null;
}

function findFoldSectionAtPosition(
  state: EditorState,
  pos: number,
): FoldSection | null {
  const foldState = state.field(headingFoldField, false);
  if (!foldState) return null;

  const line = state.doc.lineAt(pos);
  const lineSection = foldState.foldableByLineFrom.get(line.from);
  if (lineSection) return lineSection;

  let best: FoldSection | null = null;
  for (const section of allFoldSections(foldState)) {
    if (line.to <= section.foldFrom || line.from > section.foldTo) continue;
    if (!best || section.foldTo - section.foldFrom < best.foldTo - best.foldFrom) {
      best = section;
    }
  }
  return best;
}

function foldSectionFromMouseEvent(
  view: EditorView,
  event: MouseEvent,
): FoldSection | null {
  const target = event.target;
  if (target instanceof Element) {
    const toggle = target.closest<HTMLElement>(".cf-fold-toggle");
    const lineFrom = toggle?.dataset.cfFoldLineFrom;
    if (lineFrom) {
      return findFoldSectionAtLineFrom(view.state, Number(lineFrom));
    }
  }

  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  return pos === null ? null : findFoldSectionAtPosition(view.state, pos);
}

function setActiveFoldRail(view: EditorView, section: FoldSection | null): void {
  const current = view.state.field(activeFoldRailField, false)?.section ?? null;
  if (sameFoldSection(current, section)) return;
  view.dispatch({ effects: setActiveFoldRailEffect.of(section) });
}

const foldRailHoverHandlers = EditorView.domEventHandlers({
  mousemove(event, view) {
    setActiveFoldRail(view, foldSectionFromMouseEvent(view, event));
  },
  mouseleave(_event, view) {
    setActiveFoldRail(view, null);
  },
});

function createHeadingFoldState(state: EditorState): HeadingFoldState {
  const analysis = state.field(documentAnalysisField);
  const headings = analysis.headings;
  const boundaryIndices = buildHeadingBoundaryIndices(headings);
  const sectionsByHeadingIndex = buildHeadingFoldSections(
    state,
    headings,
    boundaryIndices,
  );
  const headingSections = collectSections(sectionsByHeadingIndex);
  const blockSections = buildBlockFoldSections(state, analysis.fencedDivs);
  const foldableSections = [...headingSections, ...blockSections];
  return {
    headings,
    blockSections,
    boundaryIndices,
    sectionsByHeadingIndex,
    foldableByLineFrom: buildFoldableByLineFrom(foldableSections),
    decorations: buildFoldToggles(state, foldableSections),
  };
}

function updateFoldToggles(
  tr: Transaction,
  previousDecorations: DecorationSet,
  previousSectionsByHeadingIndex: readonly (HeadingFoldSection | null)[],
  nextSectionsByHeadingIndex: readonly (HeadingFoldSection | null)[],
  affectedHeadingIndices: readonly number[],
): DecorationSet {
  let decorations = previousDecorations.map(tr.changes);
  const affectedPositions = new Set<number>();
  const nextSections: HeadingFoldSection[] = [];

  for (const index of affectedHeadingIndices) {
    const previousSection = previousSectionsByHeadingIndex[index];
    if (previousSection) {
      affectedPositions.add(tr.changes.mapPos(previousSection.headingFrom, -1));
    }

    const nextSection = nextSectionsByHeadingIndex[index];
    if (nextSection) {
      affectedPositions.add(nextSection.headingFrom);
      nextSections.push(nextSection);
    }
  }

  if (affectedPositions.size > 0) {
    const positions = [...affectedPositions].sort((left, right) => right - left);
    for (const position of positions) {
      decorations = decorations.update({
        filterFrom: position,
        filterTo: position + 1,
        filter: (from) => from !== position,
      });
    }
  }

  if (nextSections.length > 0) {
    decorations = decorations.update({
      add: buildFoldToggleItems(tr.state, nextSections),
      sort: true,
    });
  }

  return decorations;
}

const headingFoldField = StateField.define<HeadingFoldState>({
  create: createHeadingFoldState,
  update(value, tr) {
    const before = tr.startState.field(documentAnalysisField);
    const after = tr.state.field(documentAnalysisField);
    const headingsChanged = getDocumentAnalysisSliceRevision(before, "headings")
      !== getDocumentAnalysisSliceRevision(after, "headings");
    const fencedDivsChanged = getDocumentAnalysisSliceRevision(before, "fencedDivs")
      !== getDocumentAnalysisSliceRevision(after, "fencedDivs");

    if (fencedDivsChanged) {
      return createHeadingFoldState(tr.state);
    }

    if (tr.docChanged || headingsChanged) {
      const nextHeadings = after.headings;
      if (!sameHeadingTopology(value.headings, nextHeadings)) {
        return createHeadingFoldState(tr.state);
      }

      const changedHeadingIndices = findChangedHeadingIndices(
        value.headings,
        nextHeadings,
      );
      const affectedHeadingIndices = findAffectedHeadingIndices(
        value.boundaryIndices,
        changedHeadingIndices,
        tr.startState.doc.length !== tr.state.doc.length,
      );

      if (affectedHeadingIndices.length === 0) {
        return value.headings === nextHeadings ? value : { ...value, headings: nextHeadings };
      }

      const sectionsByHeadingIndex = [...value.sectionsByHeadingIndex];
      let sectionsChanged = false;

      for (const index of affectedHeadingIndices) {
        const previousSection = sectionsByHeadingIndex[index];
        const nextSection = createHeadingFoldSection(
          tr.state,
          nextHeadings,
          value.boundaryIndices[index],
          index,
        );
        if (sameHeadingFoldSection(previousSection, nextSection)) {
          continue;
        }
        sectionsByHeadingIndex[index] = nextSection;
        sectionsChanged = true;
      }

      if (!sectionsChanged) {
        return value.headings === nextHeadings ? value : { ...value, headings: nextHeadings };
      }

      return {
        headings: nextHeadings,
        blockSections: value.blockSections,
        boundaryIndices: value.boundaryIndices,
        sectionsByHeadingIndex,
        foldableByLineFrom: buildFoldableByLineFrom([
          ...collectSections(sectionsByHeadingIndex),
          ...value.blockSections,
        ]),
        decorations: updateFoldToggles(
          tr,
          value.decorations,
          value.sectionsByHeadingIndex,
          sectionsByHeadingIndex,
          affectedHeadingIndices,
        ),
      };
    }

    if (tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect))) {
      return {
        ...value,
        decorations: buildFoldToggles(
          tr.state,
          [
            ...collectSections(value.sectionsByHeadingIndex),
            ...value.blockSections,
          ],
        ),
      };
    }

    return value;
  },
  compare(a, b) {
    return a.sectionsByHeadingIndex === b.sectionsByHeadingIndex
      && a.blockSections === b.blockSections
      && a.decorations === b.decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field, (value) => value.decorations);
  },
});

/** CM6 extension for heading-based folding with inline toggles. */
export const headingFold: Extension = [
  documentAnalysisField,
  headingFoldService,
  headingFoldField,
  activeFoldRailField,
  foldRailHoverHandlers,
  keymap.of(foldKeymap),
];

export {
  activeFoldRailField as _activeFoldRailFieldForTest,
  headingFoldField as _headingFoldFieldForTest,
  setActiveFoldRailEffect as _setActiveFoldRailEffectForTest,
};
