import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownExtensions } from "../../../core/parser";
import { editorStateTextSource } from "../../state/document-analysis";
import { ensureFullSyntaxTree } from "../../test-utils";
import type { HeadingSemantics } from "../document-model";
import {
  classifyStructuralExtraction,
  expandDirtyWindows,
  planDirtyWindows,
} from "./dirty-window-planning";
import {
  type IncrementalDocumentAnalysisState,
  ZERO_REVISION_INFO,
} from "./slice-registry";
import type { DirtyWindow, SemanticDelta } from "./types";

function dirtyWindow(fromOld: number, toOld: number): DirtyWindow {
  return {
    fromOld,
    toOld,
    fromNew: fromOld,
    toNew: toOld,
  };
}

function deltaForWindow(
  window: DirtyWindow,
  plainInlineTextOnlyChange = true,
): SemanticDelta {
  return {
    rawChangedRanges: [window],
    dirtyWindows: [window],
    docChanged: true,
    syntaxTreeChanged: false,
    globalInvalidation: false,
    plainInlineTextOnlyChange,
    mapOldToNew: (pos) => pos,
    mapNewToOld: (pos) => pos,
  };
}

function headingRange(from: number, to: number): HeadingSemantics {
  return {
    from,
    to,
    level: 1,
    textFrom: from,
    textTo: to,
    text: "Heading",
    number: "1",
    appendixBoundary: false,
    unnumbered: false,
  };
}

function incrementalState(
  overrides: Partial<IncrementalDocumentAnalysisState> = {},
): IncrementalDocumentAnalysisState {
  return {
    headingSlice: {
      headings: [],
      headingByFrom: new Map(),
    },
    footnoteSlice: {
      refs: [],
      definitions: [],
      defs: new Map(),
      refByFrom: new Map(),
      defByFrom: new Map(),
      numberById: new Map(),
      orderedEntries: [],
    },
    fencedDivSlice: {
      fencedDivs: [],
      fencedDivByFrom: new Map(),
      structureRanges: [],
    },
    equationSlice: {
      equations: [],
      equationById: new Map(),
    },
    mathSlice: {
      mathRegions: [],
    },
    referenceSlice: {
      bracketedReferences: [],
      narrativeReferences: [],
      references: [],
      referenceByFrom: new Map(),
    },
    revisions: ZERO_REVISION_INFO,
    excludedRanges: [],
    referenceIndex: new Map(),
    pendingRegions: [],
    ...overrides,
  };
}

describe("dirty window planning", () => {
  it("treats inclusive boundary touches as excluded-range dirty coverage", () => {
    const windows = [dirtyWindow(10, 10)];
    const ranges = [{ from: 5, to: 10 }];

    expect(expandDirtyWindows(windows, ranges, (pos) => pos, false)).toBe(windows);
    expect(expandDirtyWindows(windows, ranges, (pos) => pos, true)).toEqual([
      {
        fromOld: 5,
        toOld: 10,
        fromNew: 5,
        toNew: 10,
      },
    ]);
  });

  it("classifies plain edits outside semantic owners as skippable", () => {
    const state = incrementalState({
      mathSlice: {
        mathRegions: [{
          from: 20,
          to: 25,
          isDisplay: false,
          contentFrom: 21,
          contentTo: 24,
          latex: "x",
        }],
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(1, 2))))
      .toBe("skip");
  });

  it("uses paragraph extraction for plain edits touching inline semantic owners", () => {
    const state = incrementalState({
      mathSlice: {
        mathRegions: [{
          from: 20,
          to: 25,
          isDisplay: false,
          contentFrom: 21,
          contentTo: 24,
          latex: "x",
        }],
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(22, 22))))
      .toBe("paragraph");
  });

  it("uses full structural extraction for edits touching structural owners", () => {
    const state = incrementalState({
      headingSlice: {
        headings: [headingRange(10, 20)],
        headingByFrom: new Map(),
      },
    });

    expect(classifyStructuralExtraction(state, deltaForWindow(dirtyWindow(12, 13))))
      .toBe("full");
  });

  it("uses full structural extraction for non-plain text changes", () => {
    const state = incrementalState();

    expect(
      classifyStructuralExtraction(
        state,
        deltaForWindow(dirtyWindow(1, 2), false),
      ),
    ).toBe("full");
  });
});

describe("dirty window availability drops", () => {
  function planFor(isSyntaxTreeAvailable: (to: number) => boolean) {
    const state = EditorState.create({
      doc: "# One\n\nAlpha beta gamma.\n",
      extensions: [markdown({ extensions: markdownExtensions })],
    });
    return planDirtyWindows(
      incrementalState(),
      editorStateTextSource(state),
      ensureFullSyntaxTree(state),
      deltaForWindow(dirtyWindow(8, 12), false),
      { isSyntaxTreeAvailable },
    );
  }

  it("records windows dropped by the availability probe", () => {
    const plan = planFor(() => false);

    expect(plan.droppedWindows).toEqual([{ from: 8, to: 12 }]);
    expect(plan.dirtyExtractions).toEqual([]);
  });

  it("keeps droppedWindows empty when the tree covers the window", () => {
    const plan = planFor(() => true);

    expect(plan.droppedWindows).toEqual([]);
    expect(plan.dirtyExtractions).toHaveLength(1);
  });
});
