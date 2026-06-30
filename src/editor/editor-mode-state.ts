import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { CSS } from "../core/constants/css-classes";
import {
  editableCompartment,
  modeClassCompartment,
  renderCompartment,
  syntaxHighlightCompartment,
} from "./compartments";
import { cm6RichRenderExtensions } from "./render/cm6-rich-render-extensions";
import { sidenotesCollapsedEffect } from "./render/sidenote-state";

export type EditorMode = "rich" | "rich-readonly" | "source";

export const markdownEditorModes: readonly EditorMode[] = ["rich", "rich-readonly", "source"];

export const setEditorModeEffect = StateEffect.define<EditorMode>();

export const editorModeField = StateField.define<EditorMode>({
  create() {
    return "rich";
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setEditorModeEffect)) return effect.value;
    }
    return value;
  },
});

const readOnlyTransactionFilter = EditorState.transactionFilter.of((tr) => {
  return tr.startState.field(editorModeField, false) === "rich-readonly" && tr.docChanged
    ? []
    : tr;
});

const sourceSyntaxHighlightingExtension = syntaxHighlighting(classHighlighter);

export function setEditorMode(view: EditorView, mode: EditorMode): void {
  const effects: StateEffect<unknown>[] = [
    setEditorModeEffect.of(mode),
  ];

  switch (mode) {
    case "rich":
      effects.push(renderCompartment.reconfigure(cm6RichRenderExtensions));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure([]));
      effects.push(syntaxHighlightCompartment.reconfigure([]));
      break;
    case "rich-readonly":
      effects.push(sidenotesCollapsedEffect.of(true));
      effects.push(renderCompartment.reconfigure(cm6RichRenderExtensions));
      effects.push(editableCompartment.reconfigure([
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: "0" }),
        readOnlyTransactionFilter,
      ]));
      effects.push(modeClassCompartment.reconfigure([]));
      effects.push(syntaxHighlightCompartment.reconfigure([]));
      break;
    case "source":
      effects.push(renderCompartment.reconfigure([]));
      effects.push(editableCompartment.reconfigure([]));
      effects.push(modeClassCompartment.reconfigure(
        EditorView.editorAttributes.of({ class: CSS.sourceMode }),
      ));
      effects.push(syntaxHighlightCompartment.reconfigure(sourceSyntaxHighlightingExtension));
      break;
  }

  view.dispatch({ effects });
}
