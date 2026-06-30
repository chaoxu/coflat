/**
 * Rich-mode "document properties" form.
 *
 * Part of the frontmatter structure-edit reveal: normally the frontmatter is
 * collapsed to the title widget, and clicking the title (or otherwise moving the
 * cursor into the frontmatter) activates the frontmatter structure edit. While
 * that edit is active the raw YAML lines are revealed for editing AND this form
 * appears above them — a field/macro editor for the panel-relevant keys (title,
 * bibliography, type, status, target) plus math macros, so the two editing
 * surfaces sit together like the rest of a revealed block. When the edit clears
 * (cursor leaves, blur) the form disappears with the YAML.
 *
 * Mounted as a top editor panel (`showPanel`), gated on the reveal state — never
 * a document decoration. The form lives outside the document model, so the
 * frontmatter edits it commits (which add/remove lines) can't crash a
 * doc-anchored block widget the way an earlier version did ("Cannot destructure
 * 'tile'"). Edits commit on `change`/blur (never per keystroke); the form
 * re-renders only when the frontmatter content actually changes, so a focused
 * input is never rebuilt out from under the user mid-typing.
 */

import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, type Panel, showPanel } from "@codemirror/view";
import katex from "katex";

import { buildKatexOptions } from "../../core/lib/katex-options";
import {
  type PanelProperties,
  readPanelProperties,
  removeMathMacro,
  renameMathMacro,
  setFrontmatterScalar,
  setMathMacro,
} from "../frontmatter-properties.js";
import { requestHandlerFacet } from "../editor-host-api";
import {
  activeStructureEditField,
  isFrontmatterStructureEditActive,
} from "../state/cm-structure-edit";
import { frontmatterField } from "../state/frontmatter-state";

/**
 * Whether focus currently lives inside the properties form. The form's inputs
 * sit outside the editor's contentDOM, so focusing one blurs the editor and
 * clears the frontmatter structure-edit reveal. We keep the form mounted while
 * it holds focus so editing a field doesn't unmount the field mid-edit.
 */
const setPropertiesFormFocused = StateEffect.define<boolean>();

const propertiesFormFocusedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPropertiesFormFocused)) return effect.value;
    }
    return value;
  },
});

const SCALAR_FIELDS: ReadonlyArray<{ key: "title" | "bibliography" | "type" | "status" | "target"; label: string }> = [
  { key: "title", label: "Title" },
  { key: "bibliography", label: "Bibliography" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "target", label: "Target" },
];

/**
 * Apply a frontmatter source mutation as a minimal diff: dispatch only the
 * changed span between the common prefix and suffix, so an edit touches the
 * smallest possible range and leaves the rest of the document untouched.
 */
function applyFrontmatterEdit(view: EditorView, mutate: (source: string) => string): void {
  const oldSource = view.state.doc.toString();
  const newSource = mutate(oldSource);
  if (newSource === oldSource) return;

  const limit = Math.min(oldSource.length, newSource.length);
  let from = 0;
  while (from < limit && oldSource[from] === newSource[from]) from++;
  let oldEnd = oldSource.length;
  let newEnd = newSource.length;
  while (oldEnd > from && newEnd > from && oldSource[oldEnd - 1] === newSource[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  view.dispatch({ changes: { from, to: oldEnd, insert: newSource.slice(from, newEnd) } });
}

function macroPreview(name: string, expansion: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "cf-doc-properties-macro-preview";
  try {
    el.innerHTML = katex.renderToString(name, {
      ...buildKatexOptions(false, { [name]: expansion }),
      throwOnError: false,
    });
  } catch {
    el.textContent = "—";
  }
  return el;
}

function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("label");
  row.className = "cf-doc-properties-row";
  const labelEl = document.createElement("span");
  labelEl.className = "cf-doc-properties-label";
  labelEl.textContent = label;
  row.append(labelEl, control);
  return row;
}

class DocumentPropertiesBuilder {
  constructor(private readonly props: PanelProperties) {}

  build(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cf-doc-properties";
    root.setAttribute("contenteditable", "false");

    const heading = document.createElement("span");
    heading.className = "cf-doc-properties-heading";
    heading.textContent = "Properties";
    root.append(heading);

    for (const { key, label } of SCALAR_FIELDS) {
      root.append(this.scalarRow(view, key, label));
    }
    root.append(this.macroEditor(view));
    return root;
  }

  private scalarRow(view: EditorView, key: (typeof SCALAR_FIELDS)[number]["key"], label: string): HTMLElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cf-doc-properties-input";
    input.value = this.props[key] ?? "";
    input.addEventListener("change", () => {
      const value = input.value.trim();
      applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, key, value === "" ? null : value));
    });

    if (key === "bibliography") {
      const handler = view.state.facet(requestHandlerFacet);
      if (handler.openBibliographyPicker) {
        const wrap = document.createElement("span");
        wrap.className = "cf-doc-properties-input-group";
        const browse = document.createElement("button");
        browse.type = "button";
        browse.className = "cf-doc-properties-browse";
        browse.textContent = "Browse…";
        browse.addEventListener("mousedown", (event) => {
          event.preventDefault();
          const controller = new AbortController();
          handler.openBibliographyPicker?.({ current: input.value, signal: controller.signal }).then((result) => {
            if (result) {
              applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, "bibliography", result.path));
            }
          });
        });
        wrap.append(input, browse);
        return fieldRow(label, wrap);
      }
    }
    return fieldRow(label, input);
  }

  private macroEditor(view: EditorView): HTMLElement {
    const section = document.createElement("div");
    section.className = "cf-doc-properties-macros";
    const heading = document.createElement("span");
    heading.className = "cf-doc-properties-label";
    heading.textContent = "Math macros";
    section.append(heading);

    for (const [name, expansion] of Object.entries(this.props.math)) {
      section.append(this.macroRow(view, name, expansion));
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "cf-doc-properties-add-macro";
    add.textContent = "+ add macro";
    add.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyFrontmatterEdit(view, (source) => setMathMacro(source, "\\new", ""));
    });
    section.append(add);
    return section;
  }

  private macroRow(view: EditorView, name: string, expansion: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "cf-doc-properties-macro-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "cf-doc-properties-macro-name";
    nameInput.value = name;
    nameInput.addEventListener("change", () => {
      const next = nameInput.value.trim();
      if (next && next !== name) applyFrontmatterEdit(view, (source) => renameMathMacro(source, name, next));
    });

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = "cf-doc-properties-macro-value";
    valueInput.value = expansion;
    valueInput.addEventListener("change", () => {
      applyFrontmatterEdit(view, (source) => setMathMacro(source, name, valueInput.value));
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cf-doc-properties-macro-remove";
    remove.setAttribute("aria-label", `Remove macro ${name}`);
    remove.textContent = "×";
    remove.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyFrontmatterEdit(view, (source) => removeMathMacro(source, name));
    });

    row.append(nameInput, valueInput, macroPreview(name, expansion), remove);
    return row;
  }
}

function propsKey(p: PanelProperties): string {
  return JSON.stringify([p.title, p.id, p.bibliography, p.type, p.status, p.target, p.math]);
}

/**
 * The form is a top editor panel (`showPanel`), gated on the frontmatter
 * structure-edit reveal — it appears with the revealed YAML and disappears when
 * the reveal clears. Living outside the document model keeps the frontmatter
 * edits it commits (which add/remove lines) from crashing a doc-anchored block
 * widget. While mounted it re-renders only when the frontmatter content changes,
 * preserving focused inputs during unrelated edits.
 */
function createPropertiesPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cf-doc-properties-host";
  let lastKey = "";

  const render = (): void => {
    const props = readPanelProperties(view.state.doc.toString());
    const key = propsKey(props);
    if (key === lastKey) return;
    lastKey = key;
    dom.replaceChildren(new DocumentPropertiesBuilder(props).build(view));
  };

  const onFocusIn = (): void => {
    if (!view.state.field(propertiesFormFocusedField, false)) {
      view.dispatch({ effects: setPropertiesFormFocused.of(true) });
    }
  };
  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && dom.contains(next)) return;
    if (view.state.field(propertiesFormFocusedField, false)) {
      view.dispatch({ effects: setPropertiesFormFocused.of(false) });
    }
  };
  dom.addEventListener("focusin", onFocusIn);
  dom.addEventListener("focusout", onFocusOut);

  render();
  return {
    dom,
    top: true,
    update(update) {
      if (update.docChanged) render();
    },
    destroy() {
      dom.removeEventListener("focusin", onFocusIn);
      dom.removeEventListener("focusout", onFocusOut);
    },
  };
}

/**
 * Whether the document-properties form should be revealed: while the frontmatter
 * structure-edit is active (title click / cursor in frontmatter), or while the
 * form itself holds focus (so editing a field keeps it mounted).
 */
function frontmatterPanelVisible(state: EditorState): boolean {
  const frontmatter = state.field(frontmatterField, false);
  if (!frontmatter || frontmatter.end <= 0) return false;
  return (
    isFrontmatterStructureEditActive(state) ||
    (state.field(propertiesFormFocusedField, false) ?? false)
  );
}

/** Rich-mode document-properties form, revealed alongside the frontmatter YAML. */
export const documentPropertiesPanel: Extension = [
  propertiesFormFocusedField,
  showPanel.compute(
    [frontmatterField, activeStructureEditField, propertiesFormFocusedField],
    (state) => (frontmatterPanelVisible(state) ? createPropertiesPanel : null),
  ),
];
