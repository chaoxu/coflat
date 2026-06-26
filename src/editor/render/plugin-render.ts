/**
 * CM6 decoration provider for rendering fenced divs using the block plugin system.
 *
 * For each FencedDiv node in the syntax tree:
 * - If a plugin is registered for its class, render using CSS marks and line
 *   decorations (Typora-style: hide syntax, show block label via ::before).
 * - If no plugin is registered, render as a plain styled div.
 *
 * Uses Decoration.mark to hide fence syntax and Decoration.line with
 * data-block-label for the rendered header. The DOM structure never changes
 * between source and rendered mode — only CSS classes are toggled.
 *
 * Uses a StateField (not ViewPlugin) so that line decorations (Decoration.line)
 * are permitted by CM6.
 */

import { EditorState, type Extension, type Transaction } from "@codemirror/state";
import {
  type DecorationSet,
} from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import { activeFencedOpenFenceStarts } from "../state/shell-ownership";
import {
  getActiveStructureEditSignature,
  hasStructureEditEffect,
  isFencedStructureSourceEditActive,
} from "../state/cm-structure-edit";
import { createChangeChecker } from "../state/change-detection";
import { collectFencedDivs } from "../fenced-block/model";
import { mathMacrosField } from "../state/math-macros";
import {
  addSingleLineClosingFence,
  addCollapsedStructureLine,
  buildFencedBlockDecorations,
  createFencedBlockDecorationField,
  hideMultiLineClosingFence,
} from "./fenced-block-core";
import {
  editorFocusField,
  focusTracker,
} from "./focus-state";
import {
  documentAnalysisField,
  getDocumentAnalysisSliceRevision,
} from "../state/document-analysis";
import { type BlockCounterState, blockCounterField } from "../state/block-counter";
import { pluginRegistryField } from "../state/plugin-registry";
import { DecorationBuilder } from "../plugins/decoration-builder";
import { fenceProtectionExtension } from "../plugins/fence-protection";
import { fenceCountMirrorExtension } from "../plugins/fence-count-mirror";
import { fenceAncestorUpgradeExtension } from "../plugins/fence-ancestor-upgrade";
import { openerTrailingProtection } from "../plugins/opener-trailing-protection";
import { getPluginOrFallback } from "../state/plugin-registry-core";
import {
  addAttributeTitleDecoration,
  addCaptionDecoration,
  addHeaderWidgetDecoration,
  addInlineHeaderDecoration,
  addInlineTitleParenDecorations,
  codeMirrorPluginRenderAdapter as pluginRenderAdapter,
} from "./plugin-adapters/chrome";
import type { BlockAttrs } from "../state/block-plugin";
import { getCm6RenderDecorations } from "../state/cm6-block-plugin";
import { applySpecialBehavior } from "../plugins/special-behavior-handlers";
import { fencedDivLiveEditorChromePlan } from "../../core/fenced-div-surface";

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function sameNumberSet(
  before: ReadonlySet<number>,
  after: ReadonlySet<number>,
): boolean {
  if (before.size !== after.size) return false;
  for (const value of before) {
    if (!after.has(value)) return false;
  }
  return true;
}

function getFencedDivRenderRevision(state: EditorState): number {
  const semantics = state.field(documentAnalysisField, false);
  return semantics ? getDocumentAnalysisSliceRevision(semantics, "fencedDivs") : -1;
}

function getBlockCounterSignature(state: EditorState): string {
  return state.field(blockCounterField, false)?.numberingKey ?? "";
}
/**
 * Build decorations for all fenced divs using the plugin registry.
 *
 * Each fence (opening and closing) is independently toggled between
 * rendered and source mode based on cursor position. Touching one
 * block's fence never affects any other block's decorations.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const registry = state.field(pluginRegistryField);
  const counterState: BlockCounterState | undefined =
    state.field(blockCounterField, false) ?? undefined;
  const macros = state.field(mathMacrosField);
  const activeShellStarts = activeFencedOpenFenceStarts(state);

  const baseDecos = buildFencedBlockDecorations(state, collectFencedDivs, ({
    state,
    block: div,
    cursorOnOpenFence,
    openLine,
    closeLine,
  }, items) => {
    const builder = new DecorationBuilder(items);
    const plugin = getPluginOrFallback(registry, div.className);

    if (!plugin) return;

    const structureEditActive = isFencedStructureSourceEditActive(state, div) || cursorOnOpenFence;
    const activeShell = activeShellStarts.has(div.openFenceFrom);

    const numberEntry = counterState?.byPosition.get(div.from);
    const labelAttrs: BlockAttrs = {
      type: div.className,
      id: div.id,
      title: div.title,
      number: numberEntry?.number,
    };
    const spec = plugin.render(labelAttrs);
    const captionBelow = plugin.captionPosition === "below";
    const inlineHeader = plugin.headerPosition === "inline";
    const hasVisibleBody = closeLine.number > openLine.number + 1;
    const chrome = fencedDivLiveEditorChromePlan({
      captionBelow,
      inlineHeader,
      displayHeader: plugin.displayHeader !== false,
      structureEditActive,
      activeShell,
      hasVisibleBody,
      hasEditableInlineTitle: div.titleFrom !== undefined && div.titleTo !== undefined,
      hasAttributeTitle: Boolean(div.title),
    });

    // --- Opening fence ---
    // Heading-like pattern: ALWAYS apply block styling, toggle marker visibility.
    // The widget replaces only the fence prefix (::: {.class}), NOT the title text.
    // Title text stays as editable content — inline plugins render math/bold/etc.
    // See CLAUDE.md "Block headers must behave like headings."
    //
    // When in source mode, cf-block-source is a MARK decoration on the fence
    // syntax only ("::: {.class}"), NOT a line decoration. This keeps the title
    // text in its natural serif font — only syntax scaffolding gets monospace.
    //
    // displayHeader === false (e.g. blockquote): omit cf-block-header so the
    // opening fence line has no rendered label. The widget still hides fence
    // syntax; block styling is still applied via spec.className.
    //
    // captionPosition === "below" (figure, table): the header label goes on
    // the last body line instead of the opening fence. The opening fence gets
    // collapsed (no label) and the title text becomes the caption, displayed
    // on the opening line without the "Figure 1." prefix.
    const headerClass = joinClasses(
      spec.className,
      CSS.blockHeader,
      activeShell && CSS.activeShell,
      activeShell && chrome.openerSlot === "visible" && CSS.activeShellTop,
      chrome.openerIsBottom && chrome.openerSlot === "visible" && CSS.activeShellBottom,
      chrome.openerSourceActive && chrome.openerSlot === "visible" && CSS.blockSource,
    );
    if (chrome.openerSlot === "visible") {
      builder.addLine(div.from, headerClass);
    } else {
      addCollapsedStructureLine(
        state,
        openLine,
        joinClasses(
          spec.className,
          CSS.blockHeaderCollapsed,
          activeShell && CSS.activeShell,
          activeShell && CSS.activeShellTop,
          chrome.openerIsBottom && CSS.activeShellBottom,
        ),
        items,
      );
    }
    // Always keep the widget replacement active — structure editing uses
    // explicit mapped state, not raw-text editing of the fence syntax.
    // Toggling the replacement on/off caused a 1px geometry delta (#1015).
    if (chrome.openerSlot === "collapsed") {
      // The whole opener line is represented by the block replacement above.
    } else if (chrome.openerLabelSlot === "empty") {
      addHeaderWidgetDecoration(
        pluginRenderAdapter,
        div,
        "",
        chrome.openerSourceActive,
        macros,
        items,
      );
    } else {
      addHeaderWidgetDecoration(
        pluginRenderAdapter,
        div,
        chrome.openerLabelSlot === "label" ? spec.header : "",
        chrome.openerSourceActive,
        macros,
        items,
      );
    }

    // Title text: wrap in visual parentheses via widget decorations (rendered mode only).
    // Uses Decoration.widget (not Decoration.mark with CSS ::before/::after) because
    // marks get split around Decoration.replace (math widgets), causing ") $x^2$".
    // For below-caption blocks, title text is the caption — no parens needed.
    if (chrome.titleSlot === "parenthesized-inline" && div.titleFrom !== undefined && div.titleTo !== undefined) {
      addInlineTitleParenDecorations(div.titleFrom, div.titleTo, items);
    }

    if (chrome.titleSlot === "hidden-inline" && div.titleFrom !== undefined && div.titleTo !== undefined) {
      builder.addHidden(div.titleFrom, div.titleTo);
    }

    // Attribute-only title (not used for below-caption blocks — their title is the caption).
    if (
      chrome.titleSlot === "attribute-title" &&
      div.titleFrom === undefined &&
      div.titleTo === undefined &&
      div.title
    ) {
      addAttributeTitleDecoration(
        pluginRenderAdapter,
        div.openFenceTo,
        div.title,
        macros,
        items,
        div.titleSourceFrom,
        div.titleSourceTo,
      );
    }

    // --- Closing fence ---
    // Always hidden in rich mode regardless of cursor position (#428).
    // The closing fence is protected from accidental deletion by a
    // transaction filter and skipped by atomicRanges (see below).
    if (div.singleLine) {
      addSingleLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
    } else {
      hideMultiLineClosingFence(state, div.closeFenceFrom, div.closeFenceTo, items);
      getCm6RenderDecorations(plugin)?.addBodyDecorations?.({
        adapter: pluginRenderAdapter,
        state,
        div,
        items,
        activeShell,
        openerSourceActive: chrome.openerSourceActive,
      });
    }

    // Body lines: apply block-type class for per-type styling (italic, etc.)
    if (!div.singleLine) {
      const closeFrom = div.closeFenceFrom >= 0 ? div.closeFenceFrom : div.to;
      const bodyCloseLine = state.doc.lineAt(closeFrom);
      for (let lineNum = openLine.number + 1; lineNum < bodyCloseLine.number; lineNum++) {
        const line = state.doc.line(lineNum);
        builder.addLine(
          line.from,
          joinClasses(
            spec.className,
            activeShell && CSS.activeShell,
            chrome.bodyShellStartsOnFirstBodyLine && lineNum === openLine.number + 1 && CSS.activeShellTop,
            chrome.bodyShellEndsOnLastBodyLine && lineNum === bodyCloseLine.number - 1 && CSS.activeShellBottom,
          ),
        );
      }

      if (chrome.bodySlot === "inline-heading") {
        const firstBodyLine = state.doc.line(openLine.number + 1);
        addInlineHeaderDecoration(
          pluginRenderAdapter,
          div,
          firstBodyLine.from,
          spec.header,
          spec.className,
          macros,
          items,
        );
      }

      // Below-caption label: add a real caption block after the content.
      if (chrome.captionSlot === "below") {
        const lastBodyLine = state.doc.line(closeLine.number - 1);
        addCaptionDecoration(
          pluginRenderAdapter,
          div,
          lastBodyLine.to,
          spec.header,
          div.title ?? "",
          macros,
          activeShell,
          items,
        );
      }
    }

    applySpecialBehavior(plugin.specialBehavior, {
      state,
      div,
      builder,
      openLine,
      activeShell,
      openerSourceActive: chrome.openerSourceActive,
    });
  });

  return baseDecos;
}

const activeShellStartsChanged = createChangeChecker({
  get: activeFencedOpenFenceStarts,
  equals: sameNumberSet,
});

const activeFencedStructureSourceChanged = createChangeChecker((state) => {
  return getActiveStructureEditSignature(state, "fenced-opener");
});

const fencedDivRenderRevisionChanged = createChangeChecker(getFencedDivRenderRevision);

const blockDecorationDependencyChanged = createChangeChecker(
  (state) => state.field(pluginRegistryField, false),
  getBlockCounterSignature,
  (state) => state.field(mathMacrosField, false),
);

function blockDecorationInputsChanged(tr: Transaction): boolean {
  return hasStructureEditEffect(tr)
    || activeFencedStructureSourceChanged(tr)
    || fencedDivRenderRevisionChanged(tr)
    || blockDecorationDependencyChanged(tr);
}

/**
 * CM6 StateField that provides block rendering decorations.
 *
 * Uses a StateField so that line decorations (Decoration.line) and
 * mark decorations are permitted by CM6.
 */
const blockDecorationField = createFencedBlockDecorationField(buildBlockDecorations, {
  extraShouldRebuild: blockDecorationInputsChanged,
  selectionShouldRebuild: activeShellStartsChanged,
  rebuildOnTreeChange: false,
  spanName: "cm6.blockPluginDecorations",
});

/** Exported for unit testing decoration logic without a browser. */
export {
  blockDecorationField as _blockDecorationFieldForTest,
  blockDecorationInputsChanged as _blockDecorationInputsChangedForTest,
};

/** CM6 extension that renders fenced divs using the block plugin system. */
export const blockRenderPlugin: Extension = [
  documentAnalysisField,
  editorFocusField,
  focusTracker,
  blockDecorationField,
  fenceProtectionExtension,
  fenceAncestorUpgradeExtension,
  fenceCountMirrorExtension,
  openerTrailingProtection,
];
