/**
 * Shared "frontmatter reveal" state.
 *
 * The frontmatter reveal is the mode in which the raw frontmatter is being
 * edited: the document-properties form (a `showPanel`) is shown and the inline
 * frontmatter region is hidden. Two render modules observe this state — the
 * properties panel (which mounts/unmounts on it) and `frontmatter-render` (which
 * hides the region while it holds) — so it lives here rather than being owned by
 * either renderer.
 */

import { type EditorState, StateEffect, StateField } from "@codemirror/state";

import { isFrontmatterStructureEditActive } from "./cm-structure-edit";
import { frontmatterField } from "./frontmatter-state";
import { programmaticDocumentChangeAnnotation } from "./programmatic-document-change";

/** Toggle whether focus currently lives inside the properties form. */
export const setPropertiesFormFocused = StateEffect.define<boolean>();

/**
 * Whether focus currently lives inside the properties form. The form's inputs
 * sit outside the editor's contentDOM, so focusing one blurs the editor and
 * clears the frontmatter structure-edit reveal. Tracking focus separately keeps
 * the form mounted while it holds focus so editing a field doesn't unmount the
 * field mid-edit.
 */
export const propertiesFormFocusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPropertiesFormFocused)) return effect.value;
    }
    // Clear the stuck-open case: the panel is destroyed (and its focusout
    // listener with it) whenever the frontmatter disappears or the document is
    // replaced, so it can never dispatch `false` itself. Reset here so a stale
    // `true` doesn't reopen the reveal on the next/replacement document.
    if (value) {
      if (tr.annotation(programmaticDocumentChangeAnnotation) === true) return false;
      const frontmatter = tr.state.field(frontmatterField, false);
      if (!frontmatter || frontmatter.end <= 0) return false;
    }
    return value;
  },
});

/**
 * Whether the frontmatter reveal is active: while the frontmatter structure-edit
 * is active (title click / cursor in frontmatter), or while the properties form
 * holds focus (so focusing a field — which blurs the editor — keeps it open).
 *
 * The panel mounts on this; `frontmatter-render` hides the frontmatter region on
 * it. Navigating away into the body clears both.
 */
export function frontmatterRevealActive(state: EditorState): boolean {
  const frontmatter = state.field(frontmatterField, false);
  if (!frontmatter || frontmatter.end <= 0) return false;
  return (
    isFrontmatterStructureEditActive(state) ||
    (state.field(propertiesFormFocusedField, false) ?? false)
  );
}
