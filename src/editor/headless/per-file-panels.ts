import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { documentSurfacePolicy } from "../../core/document-surface-policy";
import {
  documentOutlineEntry,
  type DocumentOutlineEntry,
} from "../../core/outline-surface";
import { isFrontmatterDelimiterLine } from "../../core/parser/frontmatter";
import { inlineFragmentsPlainText, parseInlineFragments } from "../inline-fragments";
import { documentContextFacet } from "../document-context";
import { renderDocumentFragmentToHtml } from "../document-surfaces";
import { createEditorReferencePresentationController } from "../references/presentation";
import { documentAnalysisField } from "../state/document-analysis";
import type { DocumentAnalysis } from "../semantics/document";
import { buildHeadingAnchorIds } from "../../core/semantics/heading-anchors";

export interface OutlineEntry extends DocumentOutlineEntry {
  /** Heading inline Markdown without leading heading markers or trailing attributes. */
  readonly markdown: string;
  /** 1-based line number for display and line-oriented navigation. */
  readonly line: number;
  /** 0-based CodeMirror document offset for exact editor navigation. */
  readonly from: number;
  /** Stable render key generated from the heading position and content. */
  readonly key: string;
}

export interface Counts {
  /** Word count for the Markdown body, excluding YAML frontmatter. */
  readonly words: number;
  /** Character count for the Markdown body, excluding YAML frontmatter. */
  readonly chars: number;
  /** Non-empty paragraph count for the Markdown body, excluding YAML frontmatter. */
  readonly paragraphs: number;
}

export interface CursorContext {
  /** 1-based cursor line number. */
  readonly line: number;
  /** 1-based cursor column within the line. */
  readonly column: number;
  /** 0-based CodeMirror document offset for the main cursor head. */
  readonly from: number;
  /** Heading breadcrumb at the cursor, from outermost to innermost heading. */
  readonly currentHeadingPath: readonly string[];
}

export interface ScrollToLineOptions {
  /** 1-based column. Defaults to 1. */
  readonly column?: number;
  /** Center the target line in the viewport when possible. */
  readonly center?: boolean;
}

export interface ScrollToPositionOptions {
  /** Center the target position in the viewport when possible. */
  readonly center?: boolean;
}

export interface HeadlessPanelStore<T> {
  get(): T;
  subscribe(callback: (value: T) => void): () => void;
}

export interface PerFilePanelApi {
  readonly extension: Extension;
  readonly outline: HeadlessPanelStore<readonly OutlineEntry[]>;
  readonly counts: HeadlessPanelStore<Counts>;
  readonly cursorContext: HeadlessPanelStore<CursorContext>;
  attach(view: EditorView): void;
  detach(): void;
  scrollToLine(line: number, options?: ScrollToLineOptions): void;
  scrollToPosition(from: number, options?: ScrollToPositionOptions): void;
}

type Equality<T> = (before: T, after: T) => boolean;

const emptyCounts: Counts = { words: 0, chars: 0, paragraphs: 0 };
const emptyCursorContext: CursorContext = {
  line: 1,
  column: 1,
  from: 0,
  currentHeadingPath: [],
};

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });

class MutablePanelStore<T> implements HeadlessPanelStore<T> {
  private callbacks = new Set<(value: T) => void>();

  constructor(
    private value: T,
    private readonly equal: Equality<T>,
  ) {}

  get(): T {
    return this.value;
  }

  set(value: T): void {
    if (this.equal(this.value, value)) {
      return;
    }
    this.value = value;
    for (const callback of this.callbacks) {
      callback(value);
    }
  }

  subscribe(callback: (value: T) => void): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  clear(): void {
    this.callbacks.clear();
  }
}

function sameOutlineEntries(
  before: readonly OutlineEntry[],
  after: readonly OutlineEntry[],
): boolean {
  return before.length === after.length
    && before.every((entry, index) => {
      const next = after[index];
      return entry.level === next?.level
        && entry.text === next.text
        && entry.markdown === next.markdown
        && entry.html === next.html
        && entry.line === next.line
        && entry.from === next.from
        && entry.key === next.key
        && entry.id === next.id
        && entry.number === next.number;
    });
}

function sameCounts(before: Counts, after: Counts): boolean {
  return before.words === after.words
    && before.chars === after.chars
    && before.paragraphs === after.paragraphs;
}

function sameCursorContext(before: CursorContext, after: CursorContext): boolean {
  return before.line === after.line
    && before.column === after.column
    && before.from === after.from
    && before.currentHeadingPath.length === after.currentHeadingPath.length
    && before.currentHeadingPath.every((value, index) =>
      value === after.currentHeadingPath[index]
    );
}

function clampPosition(doc: Text, from: number): number {
  return Math.max(0, Math.min(from, doc.length));
}

function bodyStart(doc: Text): number {
  const firstLine = doc.line(1);
  if (!isFrontmatterDelimiterLine(firstLine.text) || doc.lines < 2) {
    return 0;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (isFrontmatterDelimiterLine(line.text)) {
      return line.number < doc.lines ? line.to + 1 : line.to;
    }
  }

  return 0;
}

function countWords(text: string): number {
  let words = 0;
  for (const { isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) {
      words++;
    }
  }
  return words;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n[ \t]*\n/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .length;
}

function computeCounts(view: EditorView): Counts {
  const doc = view.state.doc;
  const start = bodyStart(doc);
  const body = doc.sliceString(start);
  return {
    words: countWords(body),
    chars: doc.length - start,
    paragraphs: countParagraphs(body),
  };
}

function computeOutline(view: EditorView): readonly OutlineEntry[] {
  const analysis = view.state.field(documentAnalysisField, false);
  if (!analysis) {
    return [];
  }

  const surfacePolicy = documentSurfacePolicy("outline-label");
  const referenceContext = createEditorReferencePresentationController(view.state, {
    surface: surfacePolicy.referenceHostSurface,
  });
  const mathMacros = view.state.facet(documentContextFacet).mathMacros;
  const headingAnchorIds = buildHeadingAnchorIds(analysis.headings);

  return analysis.headings.map((heading) => {
    const line = view.state.doc.lineAt(heading.from);
    const markdown = view.state.doc.sliceString(heading.textFrom, heading.textTo);
    const text = inlineFragmentsPlainText(parseInlineFragments(markdown));
    const html = renderDocumentFragmentToHtml({
      kind: "chrome-label",
      text: markdown,
      macros: mathMacros,
      referenceContext,
      surface: surfacePolicy.chromeLabelInlineSurface,
    });
    const id = headingAnchorIds.get(heading.from);
    if (!id) {
      throw new Error(`Missing heading outline id at ${heading.from}`);
    }
    return {
      ...documentOutlineEntry({
        id,
        level: heading.level,
        text,
        html,
        number: heading.number,
        displayUnnumbered: !heading.number,
      }),
      markdown,
      line: line.number,
      from: heading.from,
      key: String(heading.from),
    };
  });
}

function currentHeadingPathAt(
  analysis: Pick<DocumentAnalysis, "headings">,
  from: number,
): readonly string[] {
  const activeIndex = activeHeadingIndex(analysis.headings, from);
  if (activeIndex < 0) {
    return [];
  }

  const path: string[] = [];
  let currentLevel = Infinity;
  for (let index = activeIndex; index >= 0; index -= 1) {
    const heading = analysis.headings[index];
    if (heading.level < currentLevel) {
      path.unshift(heading.text);
      currentLevel = heading.level;
      if (currentLevel === 1) {
        break;
      }
    }
  }
  return path;
}

function activeHeadingIndex(
  headings: Pick<DocumentAnalysis, "headings">["headings"],
  from: number,
): number {
  let low = 0;
  let high = headings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (headings[mid].from <= from) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low - 1;
}

function computeCursorContext(view: EditorView): CursorContext {
  const from = clampPosition(view.state.doc, view.state.selection.main.head);
  const line = view.state.doc.lineAt(from);
  const analysis = view.state.field(documentAnalysisField, false);
  const currentHeadingPath = analysis ? currentHeadingPathAt(analysis, from) : [];
  return {
    line: line.number,
    column: from - line.from + 1,
    from,
    currentHeadingPath,
  };
}

function updatePanelStores(
  view: EditorView,
  outline: MutablePanelStore<readonly OutlineEntry[]>,
  counts: MutablePanelStore<Counts>,
  cursorContext: MutablePanelStore<CursorContext>,
  options: { readonly docChanged: boolean; readonly selectionSet: boolean; readonly force?: boolean },
): void {
  if (options.force || options.docChanged) {
    outline.set(computeOutline(view));
    counts.set(computeCounts(view));
  }
  if (options.force || options.docChanged || options.selectionSet) {
    cursorContext.set(computeCursorContext(view));
  }
}

export function createPerFilePanelApi(): PerFilePanelApi {
  let view: EditorView | null = null;
  const outline = new MutablePanelStore<readonly OutlineEntry[]>([], sameOutlineEntries);
  const counts = new MutablePanelStore<Counts>(emptyCounts, sameCounts);
  const cursorContext = new MutablePanelStore<CursorContext>(
    emptyCursorContext,
    sameCursorContext,
  );

  const extension = EditorView.updateListener.of((update) => {
    view = update.view;
    const documentContextChanged =
      update.startState.facet(documentContextFacet) !== update.state.facet(documentContextFacet);
    updatePanelStores(update.view, outline, counts, cursorContext, {
      docChanged: update.docChanged,
      selectionSet: update.selectionSet,
      force: documentContextChanged,
    });
  });

  const scrollToPosition = (from: number, options: ScrollToPositionOptions = {}) => {
    if (!view) {
      return;
    }
    const target = clampPosition(view.state.doc, from);
    if (options.center) {
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "center" }),
      });
    } else {
      view.dispatch({
        selection: { anchor: target },
        scrollIntoView: true,
      });
    }
    view.focus();
  };

  const scrollToLine = (line: number, options: ScrollToLineOptions = {}) => {
    if (!view) {
      return;
    }
    const docLine = view.state.doc.line(
      Math.max(1, Math.min(line, view.state.doc.lines)),
    );
    const column = Math.max(1, options.column ?? 1);
    const from = Math.min(docLine.to, docLine.from + column - 1);
    scrollToPosition(from, options);
  };

  return {
    extension,
    outline,
    counts,
    cursorContext,

    attach(nextView) {
      view = nextView;
      updatePanelStores(nextView, outline, counts, cursorContext, {
        docChanged: true,
        selectionSet: true,
        force: true,
      });
    },

    detach() {
      view = null;
      outline.clear();
      counts.clear();
      cursorContext.clear();
    },

    scrollToLine,

    scrollToPosition,
  };
}
