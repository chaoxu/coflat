/**
 * CM6 extension for Typora-style frontmatter rendering.
 *
 * Reveals raw YAML only when explicit structure editing is active;
 * otherwise replaces it with a document title widget (or hides it
 * entirely when there is no title).
 */
import { EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { CSS } from "../../core/constants/css-classes";
import { createInlineEditorController, type InlineEditorController } from "../inline-editor";
import { documentContextFacet } from "../document-context";
import { getEditorDocumentReferenceCatalog } from "../semantics/editor-reference-catalog";
import { bibDataField } from "../state/bib-data";

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
      renderDocumentFragmentToDom(titleEl, {
        kind: "title",
        text: this.title,
        macros: this.macros,
      });
      el.appendChild(titleEl);

      if (this.abstract !== undefined) {
        el.appendChild(this.createAbstractDom());
      }

      return el;
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
    renderDocumentFragmentToDom(body, {
      kind: "title",
      text: this.abstract ?? "",
      macros: this.macros,
    });
    section.appendChild(body);
    return section;
  }

  eq(other: ArticleHeaderWidget): boolean {
    return (
      this.title === other.title &&
      this.abstract === other.abstract &&
      this.abstractLabel === other.abstractLabel &&
      this.macrosKey === other.macrosKey &&
      this.active === other.active
    );
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el, view);
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
    body.style.cursor = "text";
    body.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    body.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.beginAbstractEdit(body, view);
    });
  }

  private beginAbstractEdit(body: HTMLElement, view: EditorView): void {
    if (this.abstractEditors.has(body)) return;
    body.classList.add(CSS.docAbstractEditor);
    body.replaceChildren();

    let currentDoc = this.abstract ?? "";
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

    const restoreRendered = (): void => {
      body.classList.remove(CSS.docAbstractEditor);
      body.replaceChildren();
      renderDocumentFragmentToDom(body, {
        kind: "title",
        text: this.abstract ?? "",
        macros: this.macros,
      });
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
      if (change && currentDoc !== (this.abstract ?? "")) {
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

    controller.view.dispatch({ selection: { anchor: controller.view.state.doc.length } });
    controller.view.focus();
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
    const widget = new ArticleHeaderWidget(
      config.title,
      config.abstract,
      config.titleBlock?.labels?.abstract ?? "Abstract",
      macros,
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
