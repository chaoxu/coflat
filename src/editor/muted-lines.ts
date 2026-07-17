/**
 * Muted lines — dim every line except the one holding the caret.
 *
 * A line-granular focus mode (ported from Zettlr `plugins/distraction-free.ts`):
 * when active, all lines in the viewport except the active line get a
 * `cf-muted-line` line decoration styled at 0.2 opacity with a short
 * transition. Complements the paragraph-granular `render/focus-mode.ts`.
 *
 * Wiring (integrator): append `mutedLinesExtension` to the base editor
 * extensions. The palette command self-registers through the command
 * registry facet; `toggleMutedLines` is a plain CM command usable in
 * `keybindings.ts` if a shortcut is wanted.
 */

import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { type Command, commandRegistryExtension } from "./command-registry";
import { createSimpleViewPlugin } from "./render/view-plugin-factories";
import { createBooleanToggleField } from "./state/editor-focus";

/** Class applied to every muted (non-active) line. */
const MUTED_LINE_CLASS = "cf-muted-line";

/** Effect to toggle muted lines on/off. */
export const toggleMutedLinesEffect = StateEffect.define<boolean>();

/** StateField tracking whether muted lines are active. */
const mutedLinesField = createBooleanToggleField(toggleMutedLinesEffect);

/** Line decoration that mutes content. */
const mutedLine = Decoration.line({ class: MUTED_LINE_CLASS });

/** Whether muted lines are active in the given state. */
export function isMutedLinesActive(state: EditorState): boolean {
  return state.field(mutedLinesField, false) ?? false;
}

/** Build muted-line decorations for every visible line except the active one. */
function buildMutedLineDecorations(view: EditorView): DecorationSet {
  if (!view.state.field(mutedLinesField)) return Decoration.none;

  const doc = view.state.doc;
  const activeLineFrom = doc.lineAt(view.state.selection.main.head).from;
  const decorations: Range<Decoration>[] = [];
  const seenLineStarts = new Set<number>();

  for (const range of view.visibleRanges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = doc.lineAt(pos);
      if (line.from !== activeLineFrom && !seenLineStarts.has(line.from)) {
        seenLineStarts.add(line.from);
        decorations.push(mutedLine.range(line.from));
      }
      pos = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

function mutedLinesShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.startState.field(mutedLinesField) !== update.state.field(mutedLinesField)
  );
}

/** Command that toggles muted lines. */
export function toggleMutedLines(view: EditorView): boolean {
  const current = view.state.field(mutedLinesField);
  view.dispatch({ effects: toggleMutedLinesEffect.of(!current) });
  return true;
}

/** Palette command entry for the muted lines toggle. */
export const mutedLinesCommand: Command = {
  id: "toggle-muted-lines",
  label: "Toggle Muted Lines",
  keywords: ["focus", "distraction", "mute", "dim"],
  run: ({ view }) => toggleMutedLines(view),
};

/** CM6 extension providing muted lines. */
export const mutedLinesExtension: Extension = [
  mutedLinesField,
  createSimpleViewPlugin(buildMutedLineDecorations, {
    shouldUpdate: mutedLinesShouldUpdate,
    spanName: "cm6.mutedLineDecorations",
  }),
  EditorView.baseTheme({
    [`.${MUTED_LINE_CLASS}`]: {
      opacity: "0.2",
      transition: "opacity 0.2s ease-in-out",
    },
  }),
  commandRegistryExtension([mutedLinesCommand]),
];
