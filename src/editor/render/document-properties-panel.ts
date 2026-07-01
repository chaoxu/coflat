/**
 * Rich-mode "document properties" form.
 *
 * Clicking the document title (or otherwise moving the cursor into the
 * frontmatter) activates the frontmatter reveal. While the reveal is active the
 * frontmatter is hidden from the document entirely and this form is the sole
 * frontmatter editor — a field/macro editor for the panel-relevant keys (title,
 * bibliography, type, status, target), arbitrary extra scalar properties, and
 * math macros, plus an "Edit as YAML" mode for the whole block. When the reveal
 * clears (cursor leaves, blur) the form disappears and the title collapses back.
 *
 * Mounted as a top editor panel (`showPanel`), gated on the reveal state — never
 * a document decoration. The form lives outside the document model, so the
 * frontmatter edits it commits (which add/remove lines) can't crash a
 * doc-anchored block widget the way an earlier version did ("Cannot destructure
 * 'tile'"). Edits commit on `change`/blur (never per keystroke); the form
 * rebuilds only when its row structure changes, so a focused input is never torn
 * down mid-typing.
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
import { requestHandlerFacet } from "../editor-host-api";
import {
  activeStructureEditField,
  isFrontmatterStructureEditActive,
} from "../state/cm-structure-edit";
import { frontmatterField } from "../state/frontmatter-state";
import { programmaticDocumentChangeAnnotation } from "../state/programmatic-document-change";

type PanelMode = "form" | "raw";

/**
 * Commit a pending edit in the currently-focused form control. Panel buttons use
 * mousedown-preventDefault so clicking one never blurs the focused input — which
 * also means the input's `change` (which writes the edit through) hasn't fired.
 * Firing it synthetically, without moving focus, commits the edit before the
 * button's action rebuilds the form. Scoped to our own controls by class.
 */
function commitFocusedEdit(view: EditorView): void {
  const active = view.root.activeElement;
  if (active instanceof HTMLElement && active.className.includes("cf-doc-properties")) {
    active.dispatchEvent(new Event("change"));
  }
}

/** A panel action button: shared style, mousedown-preventDefault so it never
 *  steals focus out of the form (which would close the reveal), and it commits
 *  any pending field edit first. */
function actionButton(view: EditorView, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cf-doc-properties-btn ${className}`;
  button.textContent = label;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    commitFocusedEdit(view);
    onClick();
  });
  return button;
}

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

const SCALAR_FIELDS: ReadonlyArray<{ key: "title" | "bibliography" | "type" | "status" | "target"; label: string }> = [
  { key: "title", label: "Title" },
  { key: "bibliography", label: "Bibliography" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "target", label: "Target" },
];

/**
 * The frontmatter block as a string, sliced from the document via the parsed end
 * offset. Reads go through this so they parse only the (small) frontmatter, never
 * materialize the whole (potentially large) document on every keystroke.
 */
function frontmatterSource(state: EditorState): string {
  const end = state.field(frontmatterField, false)?.end ?? 0;
  return end > 0 ? state.doc.sliceString(0, end) : "";
}

/**
 * True while a panel `render()` is tearing down its DOM. Removing a focused,
 * dirty input fires that input's native `change` synchronously mid-teardown —
 * which runs inside CM6's update cycle. Swallow those so they neither re-enter
 * `view.dispatch` (a hard CM6 error) nor resurrect a row the user just removed;
 * the real value was already committed via `commitFocusedEdit` or a prior blur.
 */
let panelRebuilding = false;

/** The smallest {from,to,insert} turning `oldStr` into `newStr` (common prefix/suffix). */
function minimalChange(oldStr: string, newStr: string): { from: number; to: number; insert: string } {
  const limit = Math.min(oldStr.length, newStr.length);
  let from = 0;
  while (from < limit && oldStr[from] === newStr[from]) from++;
  let oldEnd = oldStr.length;
  let newEnd = newStr.length;
  while (oldEnd > from && newEnd > from && oldStr[oldEnd - 1] === newStr[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { from, to: oldEnd, insert: newStr.slice(from, newEnd) };
}

/**
 * Apply a frontmatter source mutation as a minimal, bounded diff.
 *
 * When the frontmatter block ends in a newline (a body follows — the common
 * case), mutate only the `[0, end]` slice and dispatch a change bounded to it,
 * so the cost is O(frontmatter) regardless of document size and the body is never
 * materialized. A frontmatter-only doc with no trailing newline can't round-trip
 * that way (the mutator would append one), so it falls back to the full-document
 * path.
 */
function applyFrontmatterEdit(view: EditorView, mutate: (source: string) => string): void {
  // See panelRebuilding: a teardown `change` during a rebuild must not dispatch.
  if (panelRebuilding) return;

  const end = view.state.field(frontmatterField, false)?.end ?? 0;
  const block = end > 0 ? view.state.doc.sliceString(0, end) : "";
  const useSlice = end > 0 && block.endsWith("\n");
  const oldSource = useSlice ? block : view.state.doc.toString();

  let newSource: string;
  try {
    newSource = mutate(oldSource);
  } catch {
    // The `yaml` AST refuses to serialize a block with parse errors (duplicate
    // keys, an unclosed quote, tab indentation). Leave the document untouched
    // rather than letting the exception escape the DOM handler and break the
    // editor — the raw "Edit as YAML" mode is the escape hatch for such blocks.
    return;
  }
  if (newSource === oldSource) return;
  // Slice positions are already document positions (the slice starts at 0), so
  // the bounded change leaves the body untouched.
  view.dispatch({ changes: minimalChange(oldSource, newSource) });
}

// KaTeX output is pure given (name, expansion). A structural rebuild re-creates
// every macro row, so without a cache renaming one macro re-renders all N
// previews. Memoize the rendered HTML (null = render failed → show a dash).
const macroPreviewCache = new Map<string, string | null>();

function renderMacroHtml(name: string, expansion: string): string | null {
  const key = `${name}\u0000${expansion}`;
  const cached = macroPreviewCache.get(key);
  if (cached !== undefined) return cached;
  let html: string | null;
  try {
    html = katex.renderToString(name, { ...buildKatexOptions(false, { [name]: expansion }), throwOnError: false });
  } catch {
    html = null;
  }
  if (macroPreviewCache.size >= 500) macroPreviewCache.clear();
  macroPreviewCache.set(key, html);
  return html;
}

function macroPreview(name: string, expansion: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "cf-doc-properties-macro-preview";
  const html = renderMacroHtml(name, expansion);
  if (html === null) el.textContent = "—";
  else el.innerHTML = html;
  return el;
}

/** Pick a property key that doesn't collide with an existing frontmatter key. */
function freeExtraKey(extra: Readonly<Record<string, string>>): string {
  const taken = new Set<string>([...SCALAR_FIELDS.map((f) => f.key), "id", "math", ...Object.keys(extra)]);
  let key = "property";
  for (let n = 2; taken.has(key); n++) key = `property${n}`;
  return key;
}

/** Pick a macro name that doesn't collide with an existing one — so clicking
 *  "+ add macro" repeatedly adds distinct rows instead of re-setting `\new`. */
function freeMacroKey(math: Readonly<Record<string, string>>): string {
  let name = "\\new";
  for (let n = 2; name in math; n++) name = `\\new${n}`;
  return name;
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
    /** Live bibliography-picker controllers, aborted when the panel unmounts. */
    private readonly pendingPickers: Set<AbortController>,
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
      actionButton(view, "Edit as YAML", "cf-doc-properties-yaml", () => this.setMode("raw")),
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
    textarea.value = readRawFrontmatter(frontmatterSource(view.state));
    textarea.rows = Math.min(20, Math.max(4, textarea.value.split("\n").length + 1));
    textarea.addEventListener("change", () => {
      applyFrontmatterEdit(view, (source) => setRawFrontmatter(source, textarea.value));
    });
    wrap.append(textarea);

    const actions = document.createElement("div");
    actions.className = "cf-doc-properties-actions";
    actions.append(
      actionButton(view, "← Back to form", "cf-doc-properties-yaml", () => this.setMode("form")),
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
      actionButton(view, "+ add property", "cf-doc-properties-add-property", () => {
        // Read live state, not this.props: commitFocusedEdit (run first) may have
        // just renamed/added a key, so the render-time snapshot can be stale.
        const existing = readPanelProperties(frontmatterSource(view.state)).extra;
        const newKey = freeExtraKey(existing);
        applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, newKey, ""));
      }),
    );
    return section;
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
      commitFocusedEdit(view);
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
        const browse = actionButton(view, "Browse…", "cf-doc-properties-browse", () => {
          const controller = new AbortController();
          this.pendingPickers.add(controller);
          handler.openBibliographyPicker?.({ current: input.value, signal: controller.signal })
            .then((result) => {
              this.pendingPickers.delete(controller);
              // Bail if the panel was unmounted (controller aborted) or the view
              // was torn down while the picker was open — don't write behind the
              // user's back or dispatch into a dead view.
              if (result && !controller.signal.aborted && view.dom.isConnected) {
                applyFrontmatterEdit(view, (source) => setFrontmatterScalar(source, "bibliography", result.path));
              }
            })
            .catch(() => this.pendingPickers.delete(controller));
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
      actionButton(view, "+ add macro", "cf-doc-properties-add-macro", () => {
        const existing = readPanelProperties(frontmatterSource(view.state)).math;
        applyFrontmatterEdit(view, (source) => setMathMacro(source, freeMacroKey(existing), ""));
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
      commitFocusedEdit(view);
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
 * The form is a top editor panel (`showPanel`), gated on the frontmatter reveal
 * — it appears when the reveal activates and disappears when it clears. Living
 * outside the document model keeps the frontmatter edits it commits (which
 * add/remove lines) from crashing a doc-anchored block widget. While mounted it
 * rebuilds only when its row structure changes, preserving focused inputs during
 * value edits.
 */
function createPropertiesPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cf-doc-properties-host";
  let lastKey = "";
  let mode: PanelMode = "form";
  const pendingPickers = new Set<AbortController>();

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
    // The toggle button already committed any pending edit (see actionButton)
    // before invoking this.
    mode = next;
    render(true);
    // The rebuild dropped focus (the toggle button used preventDefault, so the
    // previously-focused input stayed focused until replaceChildren removed it).
    // Move focus to the new mode's primary control so the form keeps focus and
    // stays open even when `formFocused` is its only gate — otherwise the
    // navigate-away watcher would close it.
    const primary = dom.querySelector<HTMLElement>(
      next === "raw" ? ".cf-doc-properties-raw-input" : ".cf-doc-properties-input",
    );
    primary?.focus();
  };

  const render = (force = false): void => {
    const props = readPanelProperties(frontmatterSource(view.state));
    const key = `${mode}|${structureKey(props)}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    const focus = captureFocus();
    // Guard the teardown: removing a focused, dirty input fires its native
    // `change` synchronously here; panelRebuilding makes that a no-op instead of
    // a re-entrant dispatch (see applyFrontmatterEdit).
    panelRebuilding = true;
    try {
      dom.replaceChildren(new DocumentPropertiesBuilder(props, mode, setMode, pendingPickers).build(view));
    } finally {
      panelRebuilding = false;
    }
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
      // Re-render only when the frontmatter actually changed. `frontmatterField`
      // is a stable reference unless the change touched the frontmatter region,
      // so a body-only edit (a cheap pointer compare) skips the slice+parse.
      if (
        update.docChanged &&
        update.startState.field(frontmatterField, false) !== update.state.field(frontmatterField, false)
      ) {
        render();
      }
    },
    destroy() {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      for (const controller of pendingPickers) controller.abort();
      pendingPickers.clear();
      dom.removeEventListener("focusin", onFocusIn);
      dom.removeEventListener("focusout", onFocusOut);
    },
  };
}

/**
 * Whether the frontmatter reveal is active: while the frontmatter structure-edit
 * is active (title click / cursor in frontmatter), or while the properties form
 * holds focus (so focusing a field — which blurs the editor — keeps it open).
 *
 * Shared with {@link ../frontmatter-render}, which hides the frontmatter region
 * whenever this is true so the form is the only frontmatter surface. Navigating
 * away into the body clears both.
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
