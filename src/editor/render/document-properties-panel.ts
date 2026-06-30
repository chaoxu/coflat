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
  readRawFrontmatter,
  removeMathMacro,
  renameFrontmatterScalar,
  renameMathMacro,
  setFrontmatterScalar,
  setMathMacro,
  setRawFrontmatter,
} from "../frontmatter-properties.js";

type PanelMode = "form" | "raw";

/** A panel action button: shared style, and mousedown-preventDefault so clicking
 *  it never steals focus out of the form (which would close the reveal). */
function actionButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cf-doc-properties-btn ${className}`;
  button.textContent = label;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}
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

export const propertiesFormFocusedField = StateField.define<boolean>({
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
  constructor(
    private readonly props: PanelProperties,
    private readonly mode: PanelMode,
    private readonly setMode: (mode: PanelMode) => void,
  ) {}

  build(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cf-doc-properties";
    root.setAttribute("contenteditable", "false");

    const heading = document.createElement("span");
    heading.className = "cf-doc-properties-heading";
    heading.textContent = this.mode === "raw" ? "Properties · YAML" : "Properties";
    root.append(heading);

    if (this.mode === "raw") {
      root.append(this.rawEditor(view));
      return root;
    }

    for (const { key, label } of SCALAR_FIELDS) {
      root.append(this.scalarRow(view, key, label));
    }
    root.append(this.extraEditor(view));
    root.append(this.macroEditor(view));

    const actions = document.createElement("div");
    actions.className = "cf-doc-properties-actions";
    actions.append(
      actionButton("Edit as YAML", "cf-doc-properties-yaml", () => this.setMode("raw")),
    );
    root.append(actions);
    return root;
  }

  /** Raw-YAML escape hatch: edit the whole frontmatter block as text. */
  private rawEditor(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cf-doc-properties-raw";

    const textarea = document.createElement("textarea");
    textarea.className = "cf-doc-properties-raw-input";
    textarea.spellcheck = false;
    textarea.value = readRawFrontmatter(view.state.doc.toString());
    textarea.rows = Math.min(20, Math.max(4, textarea.value.split("\n").length + 1));
    textarea.addEventListener("change", () => {
      applyFrontmatterEdit(view, (source) => setRawFrontmatter(source, textarea.value));
    });
    wrap.append(textarea);

    const actions = document.createElement("div");
    actions.className = "cf-doc-properties-actions";
    actions.append(
      actionButton("← Back to form", "cf-doc-properties-yaml", () => this.setMode("form")),
    );
    wrap.append(actions);
    return wrap;
  }

  /** Editor for arbitrary user-added top-level properties (key/value pairs). */
  private extraEditor(view: EditorView): HTMLElement {
    const section = document.createElement("div");
    section.className = "cf-doc-properties-extra";

    for (const [key, value] of Object.entries(this.props.extra)) {
      section.append(this.extraRow(view, key, value));
    }

    section.append(
      actionButton("+ add property", "cf-doc-properties-add-property", () => {
        const newKey = this.freeExtraKey();
        applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, newKey, ""));
      }),
    );
    return section;
  }

  /** Pick a property key that doesn't collide with an existing frontmatter key. */
  private freeExtraKey(): string {
    const taken = new Set<string>([
      ...SCALAR_FIELDS.map((f) => f.key),
      "id",
      "math",
      ...Object.keys(this.props.extra),
    ]);
    let key = "property";
    for (let n = 2; taken.has(key); n++) key = `property${n}`;
    return key;
  }

  private extraRow(view: EditorView, key: string, value: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "cf-doc-properties-extra-row";

    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "cf-doc-properties-extra-key";
    keyInput.value = key;
    keyInput.setAttribute("aria-label", "Property name");
    keyInput.addEventListener("change", () => {
      const next = keyInput.value.trim();
      if (next && next !== key) applyFrontmatterEdit(view, (source) => renameFrontmatterScalar(source, key, next));
    });

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = "cf-doc-properties-extra-value";
    valueInput.value = value;
    valueInput.setAttribute("aria-label", "Property value");
    valueInput.addEventListener("change", () => {
      applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, key, valueInput.value));
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cf-doc-properties-macro-remove";
    remove.setAttribute("aria-label", `Remove property ${key}`);
    remove.textContent = "×";
    remove.addEventListener("mousedown", (event) => {
      event.preventDefault();
      applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, key, null));
    });

    row.append(keyInput, valueInput, remove);
    return row;
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
        const browse = actionButton("Browse…", "cf-doc-properties-browse", () => {
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

    section.append(
      actionButton("+ add macro", "cf-doc-properties-add-macro", () => {
        applyFrontmatterEdit(view, (source) => setMathMacro(source, "\\new", ""));
      }),
    );
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

/**
 * Identity of the form's *structure* — which rows exist — not their values. The
 * fixed scalar fields always render, so only the set of extra-property keys and
 * macro names matters. We rebuild only when this changes (add/remove/rename), so
 * a plain value commit never tears down the inputs (which would steal focus and,
 * mid-navigation, fight the user moving into the body). Values the user typed are
 * already in the inputs; external value edits are a rare cross-surface case.
 */
function structureKey(p: PanelProperties): string {
  return JSON.stringify([Object.keys(p.extra), Object.keys(p.math)]);
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
  let mode: PanelMode = "form";

  // Re-rendering replaces the inputs, dropping focus. Capture which control was
  // focused (by class + index) and restore it after the rebuild, so editing a
  // field or pressing "+ add" never bounces focus out of the form (which would
  // otherwise read as navigating away and close it).
  const captureFocus = (): { cls: string; idx: number; caret: number | null } | null => {
    const active = view.root.activeElement;
    if (!(active instanceof HTMLElement) || !dom.contains(active) || active.classList.length === 0) return null;
    const cls = active.classList[0];
    const peers = [...dom.querySelectorAll<HTMLElement>(`.${cls}`)];
    const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
    return { cls, idx: peers.indexOf(active), caret };
  };
  const restoreFocus = (sig: ReturnType<typeof captureFocus>): void => {
    if (!sig || sig.idx < 0) return;
    const el = dom.querySelectorAll<HTMLElement>(`.${sig.cls}`)[sig.idx];
    if (!el) return;
    el.focus();
    if (sig.caret != null && el instanceof HTMLInputElement) {
      try { el.setSelectionRange(sig.caret, sig.caret); } catch { /* unsupported input type */ }
    }
  };

  const setMode = (next: PanelMode): void => {
    if (mode === next) return;
    mode = next;
    render(true);
  };

  const render = (force = false): void => {
    const props = readPanelProperties(view.state.doc.toString());
    const key = `${mode}|${structureKey(props)}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const focus = captureFocus();
    dom.replaceChildren(new DocumentPropertiesBuilder(props, mode, setMode).build(view));
    restoreFocus(focus);
  };

  const setFocused = (value: boolean): void => {
    if ((view.state.field(propertiesFormFocusedField, false) ?? false) === value) return;
    view.dispatch({ effects: setPropertiesFormFocused.of(value) });
  };
  const onFocusIn = (): void => setFocused(true);
  // Settle focus on the next frame before deciding: `focusout.relatedTarget` is
  // unreliable across browsers (often null when clicking into the editor), so
  // check where focus actually landed instead. Closes the form deterministically
  // whenever focus leaves it for the document (navigate-away), not just on a
  // clean relatedTarget transition.
  let pendingFrame = 0;
  const onFocusOut = (): void => {
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      const active = view.root.activeElement;
      if (active instanceof Node && dom.contains(active)) return; // still in the form
      // Focus left the form for the document (or elsewhere) — navigated away.
      // Internal rebuilds restore focus into the form synchronously before this
      // frame runs, so they don't reach here.
      setFocused(false);
    });
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
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      dom.removeEventListener("focusin", onFocusIn);
      dom.removeEventListener("focusout", onFocusOut);
    },
  };
}

/**
 * Whether the frontmatter reveal is active: while the frontmatter structure-edit
 * is active (title click / cursor in frontmatter), or while the properties form
 * holds focus (so editing a field keeps both the form and the raw YAML revealed).
 *
 * Shared with {@link ../frontmatter-render} so the YAML source and the form
 * appear and disappear together — editing a field updates the visible YAML, and
 * navigating away into the body closes both.
 */
export function frontmatterRevealActive(state: EditorState): boolean {
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
    (state) => (frontmatterRevealActive(state) ? createPropertiesPanel : null),
  ),
];
