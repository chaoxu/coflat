/**
 * CM6 extension for Typora-style frontmatter rendering.
 *
 * Reveals raw YAML only when explicit structure editing is active;
 * otherwise replaces it with a document title widget (or hides it
 * entirely when there is no title).
 */

import type { Transaction } from "@codemirror/state";
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import { documentContextFacet } from "../document-context";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import {
  createCatalogReferencePresentationController,
  createEditorReferencePresentationController,
} from "../references/presentation";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import {
  activateFrontmatterStructureEdit,
  hasStructureEditEffect,
} from "../state/cm-structure-edit";
import {
  frontmatterRevealActive,
  propertiesFormFocusedField,
} from "../state/frontmatter-reveal";
import { frontmatterField } from "../state/frontmatter-state";
import { isFrontmatterActive } from "../state/shell-ownership";
import { addCollapsedStructureLine } from "./fenced-block-core.js";
import type { InlineReferenceRenderContext } from "./inline-render";
import {
  createDecorationsField,
  editorFocusField,
  focusTracker,
  ShellMacroAwareWidget,
} from "./render-core";

/** Widget that renders article frontmatter fields. */
class ArticleHeaderWidget extends ShellMacroAwareWidget {
  constructor(
    private readonly title: string,
    private readonly macros: Record<string, string>,
    private readonly referenceContext: InlineReferenceRenderContext | undefined,
    private readonly referenceKey: string,
    private readonly active: boolean = false,
  ) {
    super(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      const el = document.createElement("div");
      el.className = this.active ? `${CSS.docHeader} ${CSS.activeShellWidget}` : CSS.docHeader;

      const titleEl = document.createElement("div");
      titleEl.className = CSS.docTitle;
      this.renderTitle(titleEl, this.referenceContext);
      el.appendChild(titleEl);

      return el;
    });
  }

  private renderTitle(target: HTMLElement, referenceContext: InlineReferenceRenderContext | undefined): void {
    renderDocumentFragmentToDom(target, {
      kind: "title",
      text: this.title,
      macros: this.macros,
      referenceContext,
    });
  }

  eq(other: ArticleHeaderWidget): boolean {
    return (
      this.title === other.title &&
      this.macrosKey === other.macrosKey &&
      this.referenceKey === other.referenceKey
    );
  }

  updateDOM(dom: HTMLElement, view?: EditorView, from?: WidgetType): boolean {
    if (!(from instanceof ArticleHeaderWidget)) return false;
    dom.className = this.active ? `${CSS.docHeader} ${CSS.activeShellWidget}` : CSS.docHeader;
    this.syncWidgetAttrs(dom, view);
    const title = dom.querySelector<HTMLElement>(`.${CSS.docTitle}`);
    if (title && view) {
      this.bindSourceReveal(title, view);
    }
    return true;
  }

  override toDOM(view?: EditorView): HTMLElement {
    // createDOM already renders the title once with this.referenceContext. Every
    // input to that render (title/macros/reference key) is part of eq, so a given
    // widget instance never spans a change to any of them — the previous
    // re-render here with a freshly-built context was always identical, i.e. a
    // wasted second title render (doubling KaTeX/citation work for rich titles).
    const el = this.createDOM();
    this.syncWidgetAttrs(el, view);
    const title = el.querySelector<HTMLElement>(`.${CSS.docTitle}`);
    if (title && view) {
      this.bindSourceReveal(title, view);
    }
    return el;
  }

  protected override bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    // Idempotent: updateDOM runs on the persistent title node across rebuilds, so
    // binding unconditionally would stack a new mousedown listener every time
    // (leak + N-fold activation on a single click). Bind once per element.
    if (el.dataset.cfRevealBound === "1") return;
    el.dataset.cfRevealBound = "1";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      activateFrontmatterStructureEdit(view);
    });
  }
}

/**
 * CM6 StateField that renders frontmatter in Typora style:
 * - Explicit structure edit active: show raw YAML for editing
 * - Otherwise: replace with a document title widget (if title present)
 *   or hide entirely (if no title)
 */
const frontmatterDecorationField = createDecorationsField(
  buildDecorations,
  frontmatterShouldRebuild,
  true, // map on docChanged — frontmatter decorations depend on structure, not text
  "cm6.frontmatterDecorations",
);

/**
 * The StateField for test access only.
 *
 * @internal This is exported only for testing purposes. Use `frontmatterDecoration`
 * (the full extension) in the editor. Tests should access this field via the
 * StateField returned by this export.
 */
export { frontmatterDecorationField };

/**
 * CM6 extension that hides frontmatter and renders a document title widget.
 * Includes the focus tracker so focus/blur toggling works correctly.
 */
export const frontmatterDecoration: Extension = [
  editorFocusField,
  focusTracker,
  frontmatterDecorationField,
];

function frontmatterShouldRebuild(tr: Transaction): boolean {
  if (hasStructureEditEffect(tr)) {
    return true;
  }
  if (
    tr.startState.field(propertiesFormFocusedField, false) !==
    tr.state.field(propertiesFormFocusedField, false)
  ) {
    return true;
  }
  if (tr.effects.some((effect) => effect.is(bibDataEffect))) {
    return true;
  }
  const beforeBib = tr.startState.field(bibDataField, false);
  const afterBib = tr.state.field(bibDataField, false);
  if (
    beforeBib?.store !== afterBib?.store ||
    beforeBib?.formatter !== afterBib?.formatter ||
    beforeBib?.formatterRevision !== afterBib?.formatterRevision
  ) {
    return true;
  }
  if (tr.state.field(frontmatterField) !== tr.startState.field(frontmatterField)) {
    return true;
  }
  return isFrontmatterActive(tr.startState) !== isFrontmatterActive(tr.state);
}

function frontmatterVisualEnd(state: EditorState, frontmatterEnd: number): number {
  let visualEnd = frontmatterEnd;
  const doc = state.doc;
  // The reader drops YAML frontmatter and its separator whitespace as one
  // document shell; rich mode should replace the same visual range.
  while (visualEnd < doc.length) {
    const line = doc.lineAt(visualEnd);
    if (line.text.trim() !== "") break;
    visualEnd = line.to < doc.length ? line.to + 1 : line.to;
  }
  return visualEnd;
}

function frontmatterReferenceKey(state: EditorState): string {
  const bibData = state.field(bibDataField, false);
  if (!bibData) return "";
  return [
    bibData.store.size,
    Array.from(bibData.store.keys()).join("\0"),
    bibData.formatterRevision,
    bibData.formatter?.citationRegistrationKey ?? "",
  ].join("\u0001");
}

function createFrontmatterReferenceContext(state: EditorState): InlineReferenceRenderContext {
  const bibData = state.field(bibDataField, false);
  const formatter = bibData?.formatter ?? null;
  if (!bibData || !formatter) {
    return createEditorReferencePresentationController(state, {
      surface: "editor-header",
    });
  }

  const cite = (ids: readonly string[], locators: readonly (string | undefined)[]): string => {
    const rendered = formatter.cite([...ids], [...locators]);
    if (rendered) return rendered;
    formatter.registerCitations([{ ids: [...ids], locators: [...locators] }]);
    return formatter.cite([...ids], [...locators]);
  };

  const citeNarrative = (id: string): string => {
    const rendered = formatter.citeNarrative(id);
    if (rendered && rendered !== id) return rendered;
    if (!bibData.store.has(id)) return rendered;
    formatter.registerCitations([{ ids: [id], locators: [] }]);
    return formatter.citeNarrative(id);
  };

  return createCatalogReferencePresentationController(
    getEditorDocumentReferenceCatalog(state),
    {
      bibliography: bibData.store,
      citationKeys: bibData.store,
      documentContext: state.facet(documentContextFacet),
      cite,
      citeNarrative,
      surface: "editor-header",
    },
  );
}

/**
 * Hide the whole frontmatter region by collapsing each line. Collapse each
 * frontmatter (and trailing separator) line individually rather than with one
 * block replace spanning [0, visualEnd]:
 *   - Per-line block replacements that cover line text but NOT the trailing
 *     line break keep the break outside the decoration, so the first body line's
 *     own line decorations (paragraph-flow classification, selection hit-testing)
 *     compose normally — fixing cosheaf #200.
 *   - A single block replace over the whole region instead crashes CM6 when the
 *     region is edited at its boundary (insert at position 0).
 * Empty separator lines carry no text to replace, so they collapse via a
 * height-0 line class; they sit at the top of the document and are always drawn,
 * so the line-class height (vs. the block-model height) is safe here.
 */
function hideFrontmatterDecorations(state: EditorState, visualEnd: number): DecorationSet {
  const items: Range<Decoration>[] = [];
  for (let pos = 0; pos < visualEnd; ) {
    const line = state.doc.lineAt(pos);
    if (line.to > line.from) {
      addCollapsedStructureLine(state, line, CSS.frontmatterHidden, items);
    } else {
      items.push(Decoration.line({ class: CSS.frontmatterHidden }).range(line.from));
    }
    pos = line.to + 1;
  }
  return Decoration.set(items);
}

/** Build decorations for the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end, config } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;
  const active = isFrontmatterActive(state);
  const visualEnd = frontmatterVisualEnd(state, end);

  // When the properties panel is open it is the sole frontmatter editor — never
  // expose the raw YAML inline. Collapse to the title widget only while the
  // panel is closed; otherwise (panel open, or no title) hide the region so just
  // the panel shows.
  if (!frontmatterRevealActive(state) && config.title) {
    const widget = new ArticleHeaderWidget(
      config.title,
      config.math ?? {},
      createFrontmatterReferenceContext(state),
      frontmatterReferenceKey(state),
      active,
    );
    widget.updateSourceRange(0, end);
    return Decoration.set([
      Decoration.replace({ widget, block: true, inclusiveEnd: false }).range(0, visualEnd),
    ]);
  }

  return hideFrontmatterDecorations(state, visualEnd);
}
