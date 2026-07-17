/**
 * BlockWrapper container styling for fenced divs.
 *
 * Wraps the CONTENT lines of every fenced div that overlaps the viewport in
 * a custom `<cf-div-wrapper>` element carrying `cf-div cf-div-<name>`
 * classes, the div's user classes, its id, and `data-*` attributes for the
 * remaining key/value attributes. Fence marker lines stay OUTSIDE the
 * wrapper, and nested divs nest deterministically by depth via the
 * BlockWrapper `rank` field (outer div = higher rank).
 *
 * Wrappers persist while the selection is inside the div — deliberate
 * divergence from Zettlr's selection-based skipping (see
 * renderers/render-pandoc-div-span.ts upstream).
 *
 * This is ADDITIVE to the `data-tag-name` line styling emitted by
 * container-attributes; neither replaces the other.
 *
 * Wiring (integrator): append `fencedDivBlockWrapper` to the rich editor
 * extension bundle (e.g. in render/cm6-rich-render-extensions.ts or
 * base-editor-extensions.ts). Self-contained: bundles documentAnalysisField
 * plus its own layout-neutralizing baseTheme; no commands, no keymap.
 */

import type { Extension, Range, RangeSet, Text } from "@codemirror/state";
import {
  BlockWrapper,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { measureSync } from "../lib/perf";
import type { FencedDivSemantics } from "../semantics/document";
import { documentAnalysisField } from "../state/document-analysis";

/** Tag name of the wrapping custom element (must contain a hyphen). */
export const FENCED_DIV_WRAPPER_TAG = "cf-div-wrapper";

/** Base class carried by every fenced-div content wrapper. */
export const FENCED_DIV_WRAPPER_CLASS = "cf-div";

/**
 * Rank assigned to top-level (depth 0) div wrappers. Lower-rank wrappers
 * nest inside higher-rank ones, so rank decreases with nesting depth:
 * outermost = 100, one level deeper = 99, and so on (clamped at 0).
 */
const MAX_WRAPPER_RANK = 100;

/**
 * Attribute-name allowlist pattern for class tokens and data-* key suffixes.
 * Conservative on purpose: user-authored attribute keys and classes pass
 * through to the DOM only when they are plain identifier-like tokens.
 */
const SAFE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Slightly wider pattern for ids, which conventionally use `:` and `.`. */
const SAFE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function wrapperClassAttribute(div: FencedDivSemantics): string {
  const classes = [FENCED_DIV_WRAPPER_CLASS];
  if (div.primaryClass && SAFE_NAME_PATTERN.test(div.primaryClass)) {
    classes.push(`${FENCED_DIV_WRAPPER_CLASS}-${div.primaryClass}`);
  }
  for (const userClass of div.classes) {
    if (SAFE_NAME_PATTERN.test(userClass) && !classes.includes(userClass)) {
      classes.push(userClass);
    }
  }
  return classes.join(" ");
}

/**
 * Sanitized attribute passthrough: only `id`, `class`, and `data-*` names
 * ever reach the DOM. Key/value attributes are ALWAYS emitted under a
 * `data-` prefix, so user attributes can never become `style` or `on*`
 * event handler attributes on the wrapper element.
 */
function wrapperAttributesFor(
  div: FencedDivSemantics,
): Record<string, string> {
  const attributes: Record<string, string> = {
    class: wrapperClassAttribute(div),
  };
  if (div.id && SAFE_ID_PATTERN.test(div.id)) {
    attributes.id = div.id;
  }
  for (const [key, value] of Object.entries(div.keyValues)) {
    if (!SAFE_NAME_PATTERN.test(key)) continue;
    const lowered = key.toLowerCase();
    const name = lowered.startsWith("data-") ? lowered : `data-${lowered}`;
    attributes[name] = value;
  }
  return attributes;
}

/**
 * Document range whose covered lines get wrapped: the lines strictly between
 * the opening fence line and the closing fence line. BlockWrappers include
 * blocks starting at `from` through blocks starting at `to`, so `to` is the
 * END of the last content line (`closeFenceLine.from - 1`), keeping the
 * closing fence line itself outside the wrapper — same geometry as Zettlr.
 * Unclosed divs wrap through the end of their last line.
 */
function contentRangeFor(
  doc: Text,
  div: FencedDivSemantics,
): { from: number; to: number } | null {
  if (div.singleLine || div.isSelfClosing) return null;
  const openLine = doc.lineAt(div.openFenceFrom);
  const from = openLine.to + 1;
  const to = div.closeFenceFrom >= 0
    ? doc.lineAt(div.closeFenceFrom).from - 1
    : doc.lineAt(Math.min(div.to, doc.length)).to;
  if (from > to || from > doc.length) return null;
  return { from, to };
}

function buildFencedDivWrappers(view: EditorView): RangeSet<BlockWrapper> {
  const { state } = view;
  const semantics = state.field(documentAnalysisField, false);
  if (!semantics || semantics.fencedDivs.length === 0) {
    return BlockWrapper.set([]);
  }

  const viewport = view.viewport;
  const ranges: Range<BlockWrapper>[] = [];
  // `fencedDivs` is ordered by `from` with ancestors before descendants, so
  // a stack of enclosing `to` positions yields each div's nesting depth.
  const enclosingEnds: number[] = [];

  for (const div of semantics.fencedDivs) {
    while (
      enclosingEnds.length > 0 &&
      div.from >= enclosingEnds[enclosingEnds.length - 1]
    ) {
      enclosingEnds.pop();
    }
    const depth = enclosingEnds.length;
    enclosingEnds.push(div.to);

    // Viewport scoping: lines outside the viewport have no DOM, so only
    // divs overlapping it need wrappers.
    if (div.to < viewport.from || div.from > viewport.to) continue;

    const content = contentRangeFor(state.doc, div);
    if (!content) continue;

    const wrapper = BlockWrapper.create({
      tagName: FENCED_DIV_WRAPPER_TAG,
      attributes: wrapperAttributesFor(div),
      rank: Math.max(0, MAX_WRAPPER_RANK - depth),
    });
    ranges.push(wrapper.range(content.from, content.to));
  }

  return BlockWrapper.set(ranges, true);
}

class FencedDivBlockWrapperPlugin {
  wrappers: RangeSet<BlockWrapper>;

  constructor(view: EditorView) {
    this.wrappers = measureSync(
      "cm6.fencedDivBlockWrapper.create",
      () => buildFencedDivWrappers(view),
    );
  }

  update(update: ViewUpdate): void {
    const previousDivs =
      update.startState.field(documentAnalysisField, false)?.fencedDivs;
    const nextDivs =
      update.state.field(documentAnalysisField, false)?.fencedDivs;
    if (
      update.docChanged ||
      update.viewportChanged ||
      previousDivs !== nextDivs
    ) {
      this.wrappers = measureSync(
        "cm6.fencedDivBlockWrapper.rebuild",
        () => buildFencedDivWrappers(update.view),
      );
    }
  }
}

const fencedDivBlockWrapperPlugin = ViewPlugin.fromClass(
  FencedDivBlockWrapperPlugin,
  {
    provide: (plugin) =>
      EditorView.blockWrappers.of(
        (view) => view.plugin(plugin)?.wrappers ?? BlockWrapper.set([]),
      ),
  },
);

/**
 * Layout-neutral base styling for the wrapper element. `display: block` is
 * required for the attributes to apply as container styling; the remaining
 * `!important` declarations neutralize any user CSS targeting the div's
 * classes so wrapper styling can never alter the editor's DOM layout
 * (Zettlr's neutralization trick).
 */
const fencedDivBlockWrapperTheme = EditorView.baseTheme({
  [FENCED_DIV_WRAPPER_TAG]: {
    display: "block !important",
    // Prevent div styling from altering the DOM layout.
    flex: "initial !important",
    height: "initial !important",
    width: "initial !important",
    margin: "0 !important",
    padding: "0 !important",
    position: "static !important",
  },
});

/**
 * CM6 extension wrapping fenced-div content lines in attributed
 * `<cf-div-wrapper>` elements for container-level CSS styling.
 */
export const fencedDivBlockWrapper: Extension = [
  documentAnalysisField,
  fencedDivBlockWrapperPlugin,
  fencedDivBlockWrapperTheme,
];
