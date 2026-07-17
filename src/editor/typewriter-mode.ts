/**
 * Typewriter mode — keep the active line vertically centered while typing.
 *
 * When active, every doc-changing user transaction gets a
 * `scrollIntoView(..., { y: "center" })` effect appended via a
 * transactionExtender, and the content area gains 50vh top/bottom margins
 * (through a Compartment-managed theme) so first/last lines can still center.
 *
 * Ported from Zettlr `plugins/typewriter.ts`. One hard-won detail is kept
 * verbatim: the extender MUST return `null` when it has nothing to add.
 * Returning a spec (even an empty one) overrides behavior in other
 * transaction extenders — see Zettlr issue #6058.
 *
 * Wiring (integrator): append `typewriterModeExtension` to the base editor
 * extensions. The palette command self-registers through the command
 * registry facet; `toggleTypewriterMode` is a plain CM command usable in
 * `keybindings.ts` if a shortcut is wanted.
 */

import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Command, commandRegistryExtension } from "./command-registry";
import { createBooleanToggleField } from "./state/editor-focus";

/** Effect to toggle typewriter mode on/off. */
export const toggleTypewriterModeEffect = StateEffect.define<boolean>();

/** StateField tracking whether typewriter mode is active. */
const typewriterModeField = createBooleanToggleField(toggleTypewriterModeEffect);

/**
 * Theme applying large vertical margins to the content area so documents
 * with few lines can still center the active line.
 */
const typewriterTheme = EditorView.theme({
  ".cm-content": {
    marginTop: "50vh",
    marginBottom: "50vh",
  },
  ".cm-gutters": {
    marginTop: "50vh",
    marginBottom: "50vh",
  },
});

/** Compartment used to engage and disengage the margin theme. */
const typewriterThemeCompartment = new Compartment();

/** Whether typewriter mode is active in the given state. */
export function isTypewriterModeActive(state: EditorState): boolean {
  return state.field(typewriterModeField, false) ?? false;
}

/**
 * Transaction extender behind typewriter mode (exported for tests).
 *
 * Appends the margin-theme reconfiguration when the toggle effect is
 * present, and a center-scroll effect on doc-changing user transactions
 * while active (or when the mode just changed). Returns `null` — not an
 * empty spec — when there is nothing to extend (Zettlr issue #6058).
 */
export function extendTypewriterTransaction(
  tr: Transaction,
): Pick<TransactionSpec, "effects"> | null {
  const effects: StateEffect<unknown>[] = [];

  let active = tr.startState.field(typewriterModeField, false) ?? false;
  let modeChanged = false;
  for (const effect of tr.effects) {
    if (effect.is(toggleTypewriterModeEffect)) {
      modeChanged = modeChanged || effect.value !== active;
      active = effect.value;
      effects.push(
        typewriterThemeCompartment.reconfigure(active ? typewriterTheme : []),
      );
    }
  }

  const isUserTransaction = tr.annotation(Transaction.userEvent) !== undefined;
  if ((active && tr.docChanged && isUserTransaction) || modeChanged) {
    effects.push(
      EditorView.scrollIntoView(tr.newSelection.main.from, { y: "center" }),
    );
  }

  // MUST return null (not {} / { effects: [] }) when there is nothing to
  // extend, or other transaction extenders start to misbehave (#6058).
  return effects.length === 0 ? null : { effects };
}

/** Command that toggles typewriter mode. */
export function toggleTypewriterMode(view: EditorView): boolean {
  const current = view.state.field(typewriterModeField);
  view.dispatch({ effects: toggleTypewriterModeEffect.of(!current) });
  return true;
}

/** Palette command entry for the typewriter mode toggle. */
export const typewriterModeCommand: Command = {
  id: "toggle-typewriter-mode",
  label: "Toggle Typewriter Mode",
  keywords: ["typewriter", "center", "scroll", "writing"],
  run: ({ view }) => toggleTypewriterMode(view),
};

/** CM6 extension providing typewriter mode. */
export const typewriterModeExtension: Extension = [
  typewriterModeField,
  typewriterThemeCompartment.of([]),
  EditorState.transactionExtender.of(extendTypewriterTransaction),
  commandRegistryExtension([typewriterModeCommand]),
];
