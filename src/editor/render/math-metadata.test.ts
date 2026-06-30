import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { type ViewUpdate } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { equationLabelExtension } from "../../core/parser/equation-label";
import { mathExtension } from "../../core/parser/math-backslash";
import { activeStructureEditField } from "../state/cm-structure-edit";
import { documentAnalysisField } from "../state/document-analysis";
import { frontmatterField } from "../state/frontmatter-state";
import { createMockEditorView } from "../test-utils";
import { _docChangeAffectsVisibleMathWidgetsForTest as docChangeAffectsVisibleMathWidgets } from "./math-metadata";
import { _mathDecorationFieldForTest as mathDecorationField, mathRenderPlugin } from "./math-render";

function createMathState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ extensions: [mathExtension, equationLabelExtension] }),
      frontmatterField,
      activeStructureEditField,
      documentAnalysisField,
      mathRenderPlugin,
    ],
  });
}

function createUpdate(
  startState: EditorState,
  spec: TransactionSpec,
): ViewUpdate {
  const tr = startState.update(spec);
  const view = createMockEditorView({
    state: {
      doc: tr.state.doc,
      selection: tr.state.selection,
      sliceDoc: tr.state.sliceDoc.bind(tr.state),
      field: tr.state.field.bind(tr.state),
    },
  });
  Object.assign(view, {
    viewport: { from: 0, to: tr.state.doc.length },
  });
  return {
    view,
    startState,
    state: tr.state,
    changes: tr.changes,
  } as unknown as ViewUpdate;
}

describe("docChangeAffectsVisibleMathWidgets", () => {
  it("skips resync when the edit happens after visible math widgets", () => {
    const state = createMathState("Before $x^2$ after");
    const update = createUpdate(state, {
      changes: { from: state.doc.length, insert: "!" },
    });

    expect(
      docChangeAffectsVisibleMathWidgets(update, mathDecorationField),
    ).toBe(false);
  });

  it("resyncs when the edit happens before a visible math widget", () => {
    const state = createMathState("Before $x^2$ after");
    const update = createUpdate(state, {
      changes: { from: 0, insert: "!" },
    });

    expect(
      docChangeAffectsVisibleMathWidgets(update, mathDecorationField),
    ).toBe(true);
  });
});
