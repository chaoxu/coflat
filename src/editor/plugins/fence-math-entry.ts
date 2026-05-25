import type { AnnotationType } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  activateStructureEditTarget,
  createStructureEditTargetAt,
} from "../state/cm-structure-edit";

function activateInsertedMathBlock(view: EditorView, anchor: number): void {
  activateStructureEditTarget(
    view,
    createStructureEditTargetAt(view.state, anchor),
    anchor,
  );
}

function findNextNonBlankLine(
  view: EditorView,
  lineNumber: number,
  text: string,
) {
  for (let n = lineNumber + 1; n <= view.state.doc.lines; n += 1) {
    const line = view.state.doc.line(n);
    const trimmed = line.text.trim();
    if (trimmed === "") continue;
    if (trimmed === text) return line;
    break;
  }
  return null;
}

export function createPairedMathEntry(
  fenceOperationAnnotation: AnnotationType<true>,
) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (from !== to) return false; // has selection

    const state = view.state;
    const line = state.doc.lineAt(from);

    if (text === "$") {
      // Check if completing $$ on a (possibly indented) otherwise-blank line.
      // `before` contains everything from line start to cursor; trim leading
      // whitespace so indented lines (e.g. inside a list) still match.
      const before = state.sliceDoc(line.from, from);
      const beforeTrimmed = before.trimStart();
      if (beforeTrimmed !== "$") return false;
      const after = state.sliceDoc(from, line.to).trim();
      if (after !== "") return false;

      const existingCloseLine = findNextNonBlankLine(view, line.number, "$$");
      if (existingCloseLine) {
        const removeTo = line.to < state.doc.length ? line.to + 1 : line.to;
        const removedLength = removeTo - line.from;
        view.dispatch({
          changes: { from: line.from, to: removeTo, insert: "" },
          selection: { anchor: existingCloseLine.to - removedLength },
          annotations: fenceOperationAnnotation.of(true),
        });
        return true;
      }

      // Preserve indentation: keep the leading whitespace on all three lines.
      const indent = before.slice(0, before.length - beforeTrimmed.length);
      const anchor = line.from + indent.length + 3;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${indent}$$\n\n${indent}$$` },
        selection: { anchor },
        annotations: fenceOperationAnnotation.of(true),
      });
      activateInsertedMathBlock(view, anchor);
      return true;
    }

    if (text === "[") {
      // Check if completing \[ on a (possibly indented) otherwise-blank line.
      const before = state.sliceDoc(line.from, from);
      const beforeTrimmed = before.trimStart();
      if (beforeTrimmed !== "\\") return false;
      const after = state.sliceDoc(from, line.to).trim();
      if (after !== "") return false;

      const existingCloseLine = findNextNonBlankLine(view, line.number, "\\]");
      if (existingCloseLine) return false;

      // Preserve indentation: keep the leading whitespace on all three lines.
      const indent = before.slice(0, before.length - beforeTrimmed.length);
      const anchor = line.from + indent.length + 3;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: `${indent}\\[\n\n${indent}\\]` },
        selection: { anchor },
        annotations: fenceOperationAnnotation.of(true),
      });
      activateInsertedMathBlock(view, anchor);
      return true;
    }

    return false;
  });
}
