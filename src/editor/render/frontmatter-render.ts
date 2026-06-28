/**
 * CM6 extension for Typora-style frontmatter rendering.
 *
 * Reveals raw YAML only when explicit structure editing is active;
 * otherwise replaces it with a document title widget (or hides it
 * entirely when there is no title).
 */
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { CSS } from "../../core/constants/css-classes";
import { documentContextFacet } from "../document-context";
import {
  createCatalogReferencePresentationController,
  createEditorReferencePresentationController,
} from "../references/presentation";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import type { InlineReferenceRenderContext } from "./inline-render";

import { frontmatterField } from "../state/frontmatter-state";
import {
  createDecorationsField,
  editorFocusField,
  focusTracker,
  ShellMacroAwareWidget,
} from "./render-core";
import type { Transaction } from "@codemirror/state";
import {
  activateFrontmatterStructureEdit,
  hasStructureEditEffect,
  isFrontmatterStructureEditActive,
} from "../state/cm-structure-edit";
import { isFrontmatterActive } from "../state/shell-ownership";

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
    const el = this.createDOM();
    this.syncWidgetAttrs(el, view);
    const referenceContext = view
      ? createFrontmatterReferenceContext(view.state)
      : this.referenceContext;
    if (view) {
      const titleForRender = el.querySelector<HTMLElement>(`.${CSS.docTitle}`);
      if (titleForRender) {
        titleForRender.replaceChildren();
        this.renderTitle(titleForRender, referenceContext);
      }
    }
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

function shouldShowFrontmatterSource(state: EditorState): boolean {
  const { end } = state.field(frontmatterField);
  if (end <= 0) return false;
  return isFrontmatterStructureEditActive(state);
}

function frontmatterShouldRebuild(tr: Transaction): boolean {
  if (hasStructureEditEffect(tr)) {
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

/** Build decorations for the frontmatter region. */
function buildDecorations(state: EditorState): DecorationSet {
  const { end, config } = state.field(frontmatterField);
  if (end <= 0) return Decoration.none;
  const active = isFrontmatterActive(state);
  const visualEnd = frontmatterVisualEnd(state, end);

  if (shouldShowFrontmatterSource(state)) {
    const decos: Range<Decoration>[] = [];
    const doc = state.doc;
    for (let pos = 0; pos < end; ) {
      const line = doc.lineAt(pos);
      const isFirst = line.from === 0;
      const isLast = line.to + 1 >= end;
      const className = [
        "cf-frontmatter-line",
        active ? CSS.activeShell : "",
        active && isFirst ? CSS.activeShellTop : "",
        active && isLast ? CSS.activeShellBottom : "",
      ].filter(Boolean).join(" ");
      decos.push(Decoration.line({ class: className }).range(line.from));
      pos = line.to + 1;
    }
    return Decoration.set(decos);
  }

  if (config.title) {
    const macros = config.math ?? {};
    const referenceContext = createFrontmatterReferenceContext(state);
    const widget = new ArticleHeaderWidget(
      config.title,
      macros,
      referenceContext,
      frontmatterReferenceKey(state),
      active,
    );
    widget.updateSourceRange(0, end);
    return Decoration.set([
      Decoration.replace({
        widget,
        block: true,
        inclusiveEnd: false,
      }).range(0, visualEnd),
    ]);
  }

  return Decoration.set([Decoration.replace({ inclusiveEnd: false }).range(0, visualEnd)]);
}
