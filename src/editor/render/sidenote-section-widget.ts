import { type EditorView } from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import { createFootnoteSectionElement } from "../../core/footnote-section-surface";
import { renderDocumentFragmentToDom } from "../document-surfaces";
import { sidenotesCollapsedEffect } from "./sidenote-state";
import { RenderWidget, serializeMacros } from "./source-widget";

export interface FootnoteSectionEntry {
  readonly num: number;
  readonly id: string;
  readonly content: string;
  readonly defFrom: number;
}

/** Widget that renders a "Footnotes" section at the bottom when sidenotes are collapsed. */
export class FootnoteSectionWidget extends RenderWidget {
  private readonly macrosKey: string;

  constructor(
    private readonly entries: ReadonlyArray<FootnoteSectionEntry>,
    private readonly macros: Record<string, string>,
  ) {
    super();
    this.macrosKey = serializeMacros(macros);
  }

  createDOM(): HTMLElement {
    return this.createCachedDOM(() => {
      return createFootnoteSectionElement(
        document,
        this.entries.map((entry) => ({
          num: entry.num,
          id: entry.id,
          defFrom: entry.defFrom,
          appendContent: (content) => {
            renderFootnoteEntryContent(content, entry.content, this.macros);
          },
        })),
      );
    });
  }

  toDOM(view: EditorView): HTMLElement {
    const section = this.createDOM();
    for (const div of section.querySelectorAll<HTMLElement>(`.${CSS.bibliographyEntry}`)) {
      const defFrom = Number(div.dataset.defFrom ?? "-1");
      div.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.focus();
        view.dispatch({
          effects: sidenotesCollapsedEffect.of(false),
          selection: { anchor: defFrom },
          scrollIntoView: true,
        });
      });
    }
    return section;
  }

  eq(other: FootnoteSectionWidget): boolean {
    if (this.entries.length !== other.entries.length) return false;
    return this.entries.every(
      (e, i) =>
        e.id === other.entries[i].id &&
        e.content === other.entries[i].content &&
        e.num === other.entries[i].num &&
        e.defFrom === other.entries[i].defFrom,
    ) && this.macrosKey === other.macrosKey;
  }
}

function renderFootnoteEntryContent(
  target: HTMLElement,
  content: string,
  macros: Record<string, string>,
): void {
  renderDocumentFragmentToDom(target, {
    kind: "footnote",
    text: content,
    macros,
  });
}
