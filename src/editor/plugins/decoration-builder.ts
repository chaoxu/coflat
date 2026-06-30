import type { EditorState, Range } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import {
  type FencedDivInfo,
  getLastFencedDivContentLine,
} from "../fenced-block/model";
import { pushPluginHiddenDecoration } from "./plugin-render-adapter";

/**
 * Fluent helper for accumulating block-render decorations while keeping the
 * underlying push order stable.
 */
export class DecorationBuilder {
  constructor(private readonly items: Range<Decoration>[] = []) {}

  addHidden(from?: number, to?: number): this {
    if (from === undefined || to === undefined || to <= from) {
      return this;
    }
    pushPluginHiddenDecoration(this.items, from, to);
    return this;
  }

  addLine(at: number, className: string): this {
    if (!className) return this;
    this.items.push(Decoration.line({ class: className }).range(at));
    return this;
  }

  addQedDecoration(state: EditorState, div: FencedDivInfo): this {
    const lastContentLine = getLastFencedDivContentLine(state.doc, div);
    if (!lastContentLine) return this;
    this.addLine(lastContentLine.from, CSS.blockQed);
    return this;
  }

  build(): readonly Range<Decoration>[] {
    return this.items;
  }
}
