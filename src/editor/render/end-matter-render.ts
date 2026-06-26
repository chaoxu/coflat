import type { EditorState, Extension, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  bibliographyShouldRebuild,
  BibliographyWidget,
  createBibliographyWidgetFromState,
} from "./bibliography-render";
import { buildDecorations } from "./decoration-core";
import { createDecorationsField } from "./decoration-field";
import {
  createFootnoteSectionWidgetFromState,
  footnoteSectionShouldRebuild,
  FootnoteSectionWidget,
} from "./sidenote-render";
import { RenderWidget } from "./source-widget";

class EndMatterWidget extends RenderWidget {
  constructor(
    private readonly bibliography: BibliographyWidget | null,
    private readonly footnotes: FootnoteSectionWidget | null,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "cf-editor-end-matter";
    if (this.bibliography) {
      wrapper.appendChild(this.bibliography.toDOM(view));
    }
    if (this.footnotes) {
      wrapper.appendChild(this.footnotes.toDOM(view));
    }
    return wrapper;
  }

  override destroy(dom: HTMLElement): void {
    const bibliography = dom.querySelector<HTMLElement>(":scope > .cf-bibliography");
    if (bibliography && this.bibliography) {
      this.bibliography.destroy(bibliography);
    }
  }

  eq(other: EndMatterWidget): boolean {
    return sameWidget(this.bibliography, other.bibliography) &&
      sameWidget(this.footnotes, other.footnotes);
  }
}

function sameWidget<T extends { eq(other: T): boolean }>(
  left: T | null,
  right: T | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.eq(right);
}

function buildEndMatterDecorations(state: EditorState): DecorationSet {
  const bibliography = createBibliographyWidgetFromState(state);
  const footnotes = createFootnoteSectionWidgetFromState(state);
  if (!bibliography && !footnotes) return Decoration.none;

  return buildDecorations([
    Decoration.widget({
      widget: new EndMatterWidget(bibliography, footnotes),
      side: 1,
      block: true,
    }).range(state.doc.length),
  ]);
}

function endMatterShouldRebuild(tr: Transaction): boolean {
  return bibliographyShouldRebuild(tr) || footnoteSectionShouldRebuild(tr);
}

export const endMatterRenderPlugin: Extension = createDecorationsField(
  buildEndMatterDecorations,
  endMatterShouldRebuild,
  true,
  "cm6.endMatter",
);
