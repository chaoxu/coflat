/**
 * Rich-mode "document properties" panel.
 *
 * Renders a collapsed metadata chip above the document that expands into a small
 * form for the panel-relevant frontmatter keys (title, bibliography, type,
 * status, target) plus a math-macro key/value editor — so authors edit document
 * metadata as fields instead of hand-indenting YAML. Writes go through the
 * lossless mutators in {@link ../frontmatter-properties}, and an "Edit as YAML"
 * escape hatch drops to raw structure editing for anything the form doesn't model.
 *
 * Mounted as a top editor panel (`showPanel`), not a document decoration, so it
 * lives outside the document model: frontmatter edits that add or remove lines
 * can't crash a doc-anchored block widget. Edits commit on `change`/blur (never
 * per keystroke), and the panel re-renders only when the frontmatter or expanded
 * state actually changes, so a focused input is never rebuilt out from under the
 * user mid-typing.
 */

import { type Extension, StateEffect, StateField } from "@codemirror/state";
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
import { activateFrontmatterStructureEdit } from "../state/cm-structure-edit";
import { frontmatterField } from "../state/frontmatter-state";

/** Effect toggling the expanded/collapsed state of the properties panel. */
export const setPropertiesPanelExpanded = StateEffect.define<boolean>();

/** Whether the properties panel is expanded. Collapsed by default. */
export const propertiesPanelExpandedField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(setPropertiesPanelExpanded)) next = effect.value;
    }
    return next;
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
    private readonly expanded: boolean,
  ) {}

  build(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cf-doc-properties";
    root.setAttribute("contenteditable", "false");
    root.dataset.expanded = this.expanded ? "true" : "false";
    root.append(this.buildChip(view));
    if (this.expanded) root.append(this.buildPanel(view));
    return root;
  }

  private buildChip(view: EditorView): HTMLElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "cf-doc-properties-chip";
    chip.setAttribute("aria-expanded", this.expanded ? "true" : "false");

    const caret = document.createElement("span");
    caret.className = "cf-doc-properties-caret";
    caret.textContent = this.expanded ? "▾" : "▸";

    const summary = document.createElement("span");
    summary.className = "cf-doc-properties-summary";
    summary.append(...this.summaryParts());

    chip.append(caret, summary);
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ effects: setPropertiesPanelExpanded.of(!this.expanded) });
    });
    return chip;
  }

  private summaryParts(): Node[] {
    const parts: Node[] = [];
    const title = document.createElement("strong");
    title.textContent = this.props.title?.trim() || "Properties";
    parts.push(title);
    const meta: string[] = [];
    if (this.props.id) meta.push(this.props.id);
    if (this.props.bibliography) meta.push(this.props.bibliography);
    const macroCount = Object.keys(this.props.math).length;
    if (macroCount > 0) meta.push(`ƒ${macroCount}`);
    if (meta.length) {
      const sub = document.createElement("span");
      sub.className = "cf-doc-properties-sub";
      sub.textContent = meta.join(" · ");
      parts.push(sub);
    }
    return parts;
  }

  private buildPanel(view: EditorView): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "cf-doc-properties-panel";

    for (const { key, label } of SCALAR_FIELDS) {
      panel.append(this.scalarRow(view, key, label));
    }
    panel.append(this.macroEditor(view));

    const actions = document.createElement("div");
    actions.className = "cf-doc-properties-actions";
    const yaml = document.createElement("button");
    yaml.type = "button";
    yaml.className = "cf-doc-properties-yaml";
    yaml.textContent = "Edit as YAML";
    yaml.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      activateFrontmatterStructureEdit(view);
    });
    actions.append(yaml);
    panel.append(actions);
    return panel;
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
 * The panel is a top editor panel (`showPanel`), not a document decoration: it
 * lives outside the document model, so frontmatter edits that add/remove lines
 * never crash a block widget (CM6's "tile" crash) the way a doc-anchored widget
 * does. The panel re-renders only when the frontmatter or expanded state changes,
 * preserving focused inputs during unrelated edits.
 */
function createPropertiesPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cf-doc-properties-host";
  let lastKey = "";

  const render = (): void => {
    const frontmatter = view.state.field(frontmatterField, false);
    if (!frontmatter || frontmatter.end <= 0) {
      if (lastKey !== "") {
        dom.replaceChildren();
        lastKey = "";
      }
      return;
    }
    const expanded = view.state.field(propertiesPanelExpandedField, false) ?? false;
    const props = readPanelProperties(view.state.doc.toString());
    const key = `${expanded}|${propsKey(props)}`;
    if (key === lastKey) return;
    lastKey = key;
    dom.replaceChildren(new DocumentPropertiesBuilder(props, expanded).build(view));
  };

  render();
  return {
    dom,
    top: true,
    update(update) {
      const toggled = update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setPropertiesPanelExpanded)),
      );
      if (update.docChanged || toggled) render();
    },
  };
}

/** Rich-mode document-properties panel extension. */
export const documentPropertiesPanel: Extension = [
  propertiesPanelExpandedField,
  showPanel.of(createPropertiesPanel),
];
