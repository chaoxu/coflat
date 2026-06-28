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
import { createInlineEditorController, type InlineEditorController } from "../inline-editor";
import { documentContextFacet } from "../document-context";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import {
  createCatalogReferencePresentationController,
  createEditorReferencePresentationController,
} from "../references/presentation";
import {
  collectCitationClusters,
  getCitationRegistrationKey,
  type CitationReferenceToken,
} from "../citations/citation-matching";
import { bibDataEffect, bibDataField } from "../state/bib-data";
import { scanReferenceTokens } from "../lib/reference-tokens";
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

interface YamlKeyRange {
  readonly from: number;
  readonly to: number;
}

function findLineEnd(doc: string, from: number): { lineEnd: number; next: number } {
  const lineFeed = doc.indexOf("\n", from);
  if (lineFeed === -1) return { lineEnd: doc.length, next: doc.length };
  const lineEnd = lineFeed > from && doc[lineFeed - 1] === "\r" ? lineFeed - 1 : lineFeed;
  return { lineEnd, next: lineFeed + 1 };
}

function frontmatterBodyStart(doc: string): number | null {
  if (!doc.startsWith("---")) return null;
  const opening = findLineEnd(doc, 0);
  return opening.next < doc.length ? opening.next : null;
}

function frontmatterClosingStart(doc: string, frontmatterEnd: number): number {
  let closingEnd = frontmatterEnd;
  if (closingEnd > 0 && doc[closingEnd - 1] === "\n") closingEnd -= 1;
  if (closingEnd > 0 && doc[closingEnd - 1] === "\r") closingEnd -= 1;
  const previousLineBreak = doc.lastIndexOf("\n", closingEnd - 1);
  return previousLineBreak < 0 ? 0 : previousLineBreak + 1;
}

function topLevelYamlKey(line: string): string | null {
  if (/^\s/.test(line)) return null;
  const match = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
  return match?.[1] ?? null;
}

function findFrontmatterKeyRange(
  doc: string,
  frontmatterEnd: number,
  key: string,
): YamlKeyRange | null {
  const bodyStart = frontmatterBodyStart(doc);
  if (bodyStart === null || frontmatterEnd <= bodyStart) return null;
  const closingStart = frontmatterClosingStart(doc, frontmatterEnd);
  let pos = bodyStart;
  while (pos < closingStart) {
    const line = findLineEnd(doc, pos);
    const lineText = doc.slice(pos, line.lineEnd);
    const lineKey = topLevelYamlKey(lineText);
    if (lineKey === key) {
      let to = line.next;
      while (to < closingStart) {
        const nextLine = findLineEnd(doc, to);
        const nextText = doc.slice(to, nextLine.lineEnd);
        const nextKey = topLevelYamlKey(nextText);
        if (nextKey !== null) break;
        to = nextLine.next;
      }
      return { from: pos, to };
    }
    pos = line.next;
  }
  return null;
}

function yamlBlockScalar(key: string, value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  return `${key}: |\n${lines.map((line) => line.length === 0 ? "" : `  ${line}`).join("\n")}\n`;
}

function updateFrontmatterStringField(
  doc: string,
  frontmatterEnd: number,
  key: string,
  value: string,
): { from: number; to: number; insert: string } | null {
  const bodyStart = frontmatterBodyStart(doc);
  if (bodyStart === null || frontmatterEnd <= bodyStart) return null;
  const replacement = yamlBlockScalar(key, value);
  const existing = findFrontmatterKeyRange(doc, frontmatterEnd, key);
  if (existing) return { ...existing, insert: replacement };

  const title = findFrontmatterKeyRange(doc, frontmatterEnd, "title");
  const insertAt = title?.to ?? bodyStart;
  return { from: insertAt, to: insertAt, insert: replacement };
}

/** Widget that renders article frontmatter fields. */
class ArticleHeaderWidget extends ShellMacroAwareWidget {
  private readonly abstractEditors = new WeakMap<HTMLElement, InlineEditorController>();

  constructor(
    private readonly title: string,
    private readonly abstract: string | undefined,
    private readonly abstractLabel: string,
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

      if (this.abstract !== undefined) {
        el.appendChild(this.createAbstractDom());
      }

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

  private renderAbstractBody(
    target: HTMLElement,
    referenceContext: InlineReferenceRenderContext | undefined,
  ): void {
    renderDocumentFragmentToDom(target, {
      kind: "title",
      text: this.abstract ?? "",
      macros: this.macros,
      referenceContext,
      surface: "document-inline",
    });
  }

  private createAbstractDom(): HTMLElement {
    const section = document.createElement("div");
    section.className = CSS.docAbstract;

    const label = document.createElement("div");
    label.className = CSS.docAbstractLabel;
    label.textContent = this.abstractLabel;
    section.appendChild(label);

    const body = document.createElement("div");
    body.className = CSS.docAbstractBody;
    this.renderAbstractBody(body, this.referenceContext);
    section.appendChild(body);
    return section;
  }

  eq(other: ArticleHeaderWidget): boolean {
    return (
      this.title === other.title &&
      this.abstract === other.abstract &&
      this.abstractLabel === other.abstractLabel &&
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
    const abstract = dom.querySelector<HTMLElement>(`.${CSS.docAbstract}`);
    if (abstract && view) {
      this.bindAbstractEditor(abstract, view);
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
      registerAbstractCitations(view.state, this.abstract);
      const titleForRender = el.querySelector<HTMLElement>(`.${CSS.docTitle}`);
      if (titleForRender) {
        titleForRender.replaceChildren();
        this.renderTitle(titleForRender, referenceContext);
      }
      const bodyForRender = el.querySelector<HTMLElement>(`.${CSS.docAbstractBody}`);
      if (bodyForRender && !this.abstractEditors.has(bodyForRender)) {
        bodyForRender.replaceChildren();
        this.renderAbstractBody(bodyForRender, referenceContext);
      }
    }
    const title = el.querySelector<HTMLElement>(`.${CSS.docTitle}`);
    if (title && view) {
      this.bindSourceReveal(title, view);
    }
    const abstract = el.querySelector<HTMLElement>(`.${CSS.docAbstract}`);
    if (abstract && view) {
      this.bindAbstractEditor(abstract, view);
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

  private bindAbstractEditor(section: HTMLElement, view: EditorView): void {
    const body = section.querySelector<HTMLElement>(`.${CSS.docAbstractBody}`);
    if (!body) return;
    if (isEditorReadOnly(view)) return;
    section.setAttribute("aria-label", "Edit abstract");
    section.title = "Edit abstract";
    section.style.cursor = "text";
    body.style.cursor = "text";
    const isEditing = (): boolean =>
      this.abstractEditors.has(body) || body.classList.contains(CSS.docAbstractEditor);
    const open = (event: Event): void => {
      if (isEditing()) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginAbstractEdit(
        body,
        view,
        event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : undefined,
      );
    };
    section.addEventListener("mousedown", (event) => {
      if (isEditing()) return;
      event.preventDefault();
      event.stopPropagation();
    });
    section.addEventListener("click", open);
    section.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      open(event);
    });
  }

  private beginAbstractEdit(
    body: HTMLElement,
    view: EditorView,
    clickCoords?: { readonly x: number; readonly y: number },
  ): void {
    if (this.abstractEditors.has(body)) return;
    body.classList.add(CSS.docAbstractEditor);
    body.replaceChildren();

    const originalDoc = (this.abstract ?? "").replace(/\n$/, "");
    let currentDoc = originalDoc;
    let closed = false;
    const bibData = view.state.field(bibDataField, false);
    const controller = createInlineEditorController({
      parent: body,
      doc: currentDoc,
      macros: this.macros,
      bibData: bibData ?? undefined,
      documentContext: view.state.facet(documentContextFacet),
      referenceCatalog: getEditorDocumentReferenceCatalog(view.state),
      onChange: (newDoc) => {
        currentDoc = newDoc;
      },
    });
    this.abstractEditors.set(body, controller);
    let opening = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        opening = false;
      });
    });

    const restoreRendered = (): void => {
      body.classList.remove(CSS.docAbstractEditor);
      body.replaceChildren();
      registerAbstractCitations(view.state, this.abstract);
      this.renderAbstractBody(body, createFrontmatterReferenceContext(view.state));
    };

    const commit = () => {
      if (closed) return;
      closed = true;
      this.abstractEditors.delete(body);
      controller.destroy();
      const frontmatter = view.state.field(frontmatterField, false);
      const change = frontmatter
        ? updateFrontmatterStringField(
          view.state.doc.toString(),
          frontmatter.end,
          "abstract",
          currentDoc,
        )
        : null;
      if (change && currentDoc !== originalDoc) {
        view.dispatch({
          changes: change,
          scrollIntoView: false,
        });
      } else {
        restoreRendered();
      }
      view.focus();
    };
    const cancel = () => {
      if (closed) return;
      closed = true;
      this.abstractEditors.delete(body);
      controller.destroy();
      restoreRendered();
      view.focus();
    };

    controller.setCallbacks({
      onChange: (newDoc) => {
        currentDoc = newDoc;
      },
      onBlur: () => {
        if (opening) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (
              document.activeElement instanceof HTMLElement &&
              body.contains(document.activeElement)
            ) {
              return;
            }
            commit();
          });
        });
      },
      onKeydown: (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return true;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          event.stopPropagation();
          commit();
          return true;
        }
        return false;
      },
    });

    requestAnimationFrame(() => {
      let anchor = controller.view.state.doc.length;
      if (clickCoords) {
        try {
          anchor = controller.view.posAtCoords(clickCoords) ?? anchor;
        } catch (_error) {
          anchor = controller.view.state.doc.length;
        }
      }
      controller.view.dispatch({ selection: { anchor } });
      controller.view.focus();
    });
  }

  override destroy(dom: HTMLElement): void {
    for (const body of dom.querySelectorAll<HTMLElement>(`.${CSS.docAbstractBody}`)) {
      const controller = this.abstractEditors.get(body);
      if (!controller) continue;
      controller.destroy();
      this.abstractEditors.delete(body);
    }
  }
}

function isEditorReadOnly(view: EditorView): boolean {
  try {
    return view.state.facet(EditorState.readOnly) === true ||
      view.state.facet(EditorView.editable) === false;
  } catch (_error) {
    return false;
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

function registerAbstractCitations(state: EditorState, abstract: string | undefined): void {
  if (!abstract) return;
  const bibData = state.field(bibDataField, false);
  if (!bibData?.formatter || bibData.store.size === 0) return;
  const tokens: CitationReferenceToken[] = scanReferenceTokens(abstract).map((token) => ({
    id: token.id,
    clusterFrom: token.clusterFrom,
    clusterTo: token.clusterTo,
    clusterIndex: token.clusterIndex,
    locator: token.locator,
  }));
  const clusters = collectCitationClusters(tokens, bibData.store);
  if (clusters.length === 0) return;
  const key = getCitationRegistrationKey(clusters);
  if (bibData.formatter.citationRegistrationKey === key) return;
  bibData.formatter.registerCitations(clusters);
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
    registerAbstractCitations(state, config.abstract);
    const referenceContext = createFrontmatterReferenceContext(state);
    const widget = new ArticleHeaderWidget(
      config.title,
      config.abstract,
      config.titleBlock?.labels?.abstract ?? "Abstract",
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
