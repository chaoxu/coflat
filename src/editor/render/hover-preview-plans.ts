import { type EditorView } from "@codemirror/view";
import { CSS } from "../../core/constants";
import { documentSurfacePolicy } from "../../core/document-surface-policy";
import { createPreviewSurfaceBody } from "../../core/preview-surface";
import {
  type ReferencePreviewBodyPlan,
  type ReferencePreviewSurfacePlan,
  referencePreviewBodyPlan,
  referencePreviewContentPlan,
  referencePreviewSurfacePlan,
  unresolvedReferencePreviewLabel,
} from "../../core/reference-preview-source";
import {
  createEditorReferencePresentationController,
  type ReferenceClassification,
  type ResolvedCrossref,
} from "../references/presentation";
import { type BibStore, bibDataField } from "../state/bib-data";
import { blockCounterField, type NumberedBlock } from "../state/block-counter";
import { documentAnalysisField } from "../state/document-analysis";
import { mathMacrosField } from "../state/math-macros";
import { pluginRegistryField } from "../state/plugin-registry";
import { getPlugin } from "../state/plugin-registry-core";
import {
  buildCitationItemTooltipPlan,
  buildCitationTooltipPlan,
} from "./hover-citation-preview";
import { buildPreviewBlockOptions } from "./hover-preview-block-options";
import {
  createHoverPreviewContent,
  createHoverPreviewHeader,
} from "./hover-preview-elements";
import {
  appendMediaFallback,
  buildBlockPreviewMediaState,
  normalizeWidePreviewContent,
  replacePdfPreviewImages,
} from "./hover-preview-media";
import { type TooltipPlan } from "./hover-tooltip";
import { renderKatex } from "./math-widget";
import {
  EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  type LocalMediaDependencies,
} from "./media-preview";
import { renderPreviewBlockContentToDom } from "./preview-block-renderer";
import { findRenderedReference } from "./reference-targeting";
import { findReferenceWidgetContainer } from "./reference-widget";

export { normalizeWidePreviewContentForTest } from "./hover-preview-media";

interface BlockPreviewPlan {
  readonly buildBody: () => HTMLElement | null;
  readonly key: string;
  readonly mediaDependencies: LocalMediaDependencies;
}

type CrossrefPreviewVariant = "completion" | "hover";

export function shouldReuseTooltipContent(
  currentPlan: Pick<TooltipPlan, "key"> | null,
  nextPlan: Pick<TooltipPlan, "key">,
  forceRebuild: boolean,
): boolean {
  return !forceRebuild && currentPlan !== null && nextPlan.key === currentPlan.key;
}

export function shouldRebuildHoverPreviewContentForTest(
  currentKey: string | null,
  nextKey: string,
  forceRebuild: boolean,
): boolean {
  return !shouldReuseTooltipContent(
    currentKey === null ? null : { key: currentKey },
    { key: nextKey },
    forceRebuild,
  );
}

// ── Content extraction helpers ──────────────────────────────────────────────

function blockPreviewBodyInput(
  view: EditorView,
  block: NumberedBlock,
  useFullSource: boolean,
) {
  const doc = view.state.doc;
  const div = view.state.field(documentAnalysisField).fencedDivByFrom.get(block.from);
  const bodyRange = div
    ? { from: div.openFenceTo, to: div.closeFenceFrom >= 0 ? div.closeFenceFrom : block.to }
    : { from: block.from, to: block.to };
  return {
    kind: "block" as const,
    fullSource: useFullSource ? doc.sliceString(block.from, block.to) : "",
    bodySource: doc.sliceString(bodyRange.from, bodyRange.to),
    useFullSource,
  };
}

function createCrossrefPreviewContainer(
  variant: CrossrefPreviewVariant,
): HTMLElement {
  return createHoverPreviewContent(
    variant === "completion" ? CSS.referenceCompletionContent : null,
  );
}

function appendCrossrefPreviewSlots(
  container: HTMLElement,
  surfacePlan: ReferencePreviewSurfacePlan,
  body: HTMLElement | null,
  macros: Record<string, string>,
): void {
  for (const slot of surfacePlan.slots) {
    if (slot === "body" && body) {
      container.appendChild(body);
    } else if (slot === "header") {
      container.appendChild(
        createHoverPreviewHeader(
          surfacePlan.headerText,
          macros,
          surfacePlan.headerSlotClass === "completion-meta" ? CSS.referenceCompletionMeta : undefined,
        ),
      );
    }
  }
}

/**
 * Find the LaTeX source for an equation by its label id.
 * Scans the syntax tree for EquationLabel nodes and extracts the
 * parent DisplayMath content.
 */
function findEquationSource(view: EditorView, id: string): string | undefined {
  const equation = view.state.field(documentAnalysisField).equationById.get(id);
  if (!equation) return undefined;
  return equation.latex.trim();
}

// ── Tooltip content builders ────────────────────────────────────────────────

function buildBlockPreviewPlan(
  view: EditorView,
  block: NumberedBlock,
  useFullBlockSource: boolean,
  macros: Record<string, string>,
  preplannedBody?: ReferencePreviewBodyPlan,
): BlockPreviewPlan {
  const bodyPlan = preplannedBody
    ?? referencePreviewBodyPlan(blockPreviewBodyInput(view, block, useFullBlockSource));
  if (bodyPlan.kind !== "markdown") {
    return {
      buildBody: () => null,
      key: bodyPlan.key,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  const text = bodyPlan.markdownSource;
  const mediaState = buildBlockPreviewMediaState(view, text);
  return {
    buildBody: () => {
      const body = createPreviewSurfaceBody(CSS.hoverPreviewBody);
      renderPreviewBlockContentToDom(
        body,
        text,
        buildPreviewBlockOptions(view, macros, mediaState.imageUrlOverrides, "hover-preview"),
      );
      replacePdfPreviewImages(body, mediaState.readyPdfPreviews);
      normalizeWidePreviewContent(body);
      appendMediaFallback(
        body,
        mediaState.loadingLocalMedia,
        mediaState.unavailableLocalMedia,
      );
      return body;
    },
    key: `${bodyPlan.key}\0${mediaState.key}`,
    mediaDependencies: mediaState.mediaDependencies,
  };
}

export function buildBlockPreviewBodyForTest(
  view: EditorView,
  block: NumberedBlock,
): HTMLElement | null {
  const macros = view.state.field(mathMacrosField, false) ?? {};
  const registry = view.state.field(pluginRegistryField, false);
  const plugin = registry ? getPlugin(registry, block.type) : undefined;
  return buildBlockPreviewPlan(
    view,
    block,
    plugin?.captionPosition === "below",
    macros,
  ).buildBody();
}

/**
 * Build the tooltip plan for a cross-reference hover preview.
 * Accepts pre-resolved data to avoid redundant resolution.
 */
function buildCrossrefTooltipPlan(
  view: EditorView,
  id: string,
  resolved: ResolvedCrossref,
  variant: CrossrefPreviewVariant = "hover",
): TooltipPlan {
  const macros = view.state.field(mathMacrosField, false) ?? {};

  if (resolved.kind === "block") {
    const counterState = view.state.field(blockCounterField, false);
    const block = counterState?.byId.get(id);
    const registry = view.state.field(pluginRegistryField, false);
    const plugin = block && registry ? getPlugin(registry, block.type) : undefined;
    const bodyInput = block
      ? blockPreviewBodyInput(view, block, plugin?.captionPosition === "below")
      : undefined;
    const previewPlan = referencePreviewContentPlan({
      target: resolved,
      fallbackLabel: id,
      bodyInput,
    });
    const bodyPlan = block
      ? buildBlockPreviewPlan(
        view,
        block,
        plugin?.captionPosition === "below",
        macros,
        previewPlan.bodyPlan,
      )
      : null;

    return {
      buildContent: () => {
        const body = bodyPlan?.buildBody();
        const surfacePlan = referencePreviewSurfacePlan(previewPlan, {
          variant,
          hasBody: !!body,
        });
        const container = createCrossrefPreviewContainer(variant);
        appendCrossrefPreviewSlots(container, surfacePlan, body ?? null, macros);
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: true,
      dependsOnMacros: true,
      key: `crossref:block\0${variant}\0${id}\0${previewPlan.key}\0${bodyPlan?.key ?? "missing"}`,
      mediaDependencies: bodyPlan?.mediaDependencies ?? EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  if (resolved.kind === "heading") {
    const previewPlan = referencePreviewContentPlan({
      target: resolved,
      fallbackLabel: id,
    });

    return {
      buildContent: () => {
        const container = createCrossrefPreviewContainer(variant);
        appendCrossrefPreviewSlots(
          container,
          referencePreviewSurfacePlan(previewPlan, { variant, hasBody: false }),
          null,
          macros,
        );
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: false,
      dependsOnMacros: true,
      key: `crossref:heading\0${variant}\0${id}\0${previewPlan.key}`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  if (resolved.kind === "equation") {
    const previewPlan = referencePreviewContentPlan({
      target: resolved,
      fallbackLabel: id,
      bodyInput: {
        kind: "equation",
        latex: findEquationSource(view, id) ?? "",
      },
    });
    return {
      buildContent: () => {
        const container = createCrossrefPreviewContainer(variant);
        const body = previewPlan.bodyPlan.kind === "display-math"
          ? createPreviewSurfaceBody(CSS.hoverPreviewBody)
          : null;

        if (body && previewPlan.bodyPlan.kind === "display-math") {
          renderKatex(body, previewPlan.bodyPlan.latex, true, macros);
        }

        appendCrossrefPreviewSlots(
          container,
          referencePreviewSurfacePlan(previewPlan, { variant, hasBody: !!body }),
          body,
          macros,
        );
        return container;
      },
      cacheScope: view.state,
      dependsOnBibliography: false,
      dependsOnMacros: true,
      key: `crossref:equation\0${variant}\0${id}\0${previewPlan.key}`,
      mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
    };
  }

  return {
    buildContent: () => {
      const container = createCrossrefPreviewContainer(variant);
      container.appendChild(
        createHoverPreviewHeader(
          unresolvedReferencePreviewLabel(id),
          macros,
          CSS.hoverPreviewUnresolved,
        ),
      );
      return container;
    },
    cacheScope: view.state,
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `crossref:unresolved\0${variant}\0${id}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}

export function buildCrossrefPreviewContent(
  view: EditorView,
  id: string,
): HTMLElement {
  const equationLabels = view.state.field(documentAnalysisField, false)?.equationById;
  const presentation = createEditorReferencePresentationController(view.state, {
    equationLabels,
    surface: documentSurfacePolicy("hover-preview").referenceHostSurface,
  });
  const classification = presentation.classify(id, false);
  return buildCrossrefTooltipPlan(
    view,
    id,
    classification.kind === "crossref"
      ? classification.resolved
      : { kind: "unresolved", label: id },
    "hover",
  ).buildContent();
}

export function buildCrossrefCompletionPreviewContent(
  view: EditorView,
  id: string,
): HTMLElement {
  const equationLabels = view.state.field(documentAnalysisField, false)?.equationById;
  const presentation = createEditorReferencePresentationController(view.state, {
    equationLabels,
    surface: documentSurfacePolicy("completion-preview").referenceHostSurface,
  });
  const classification = presentation.classify(id, false);
  return buildCrossrefTooltipPlan(
    view,
    id,
    classification.kind === "crossref"
      ? classification.resolved
      : { kind: "unresolved", label: id },
    "completion",
  ).buildContent();
}

/**
 * Build the tooltip plan for a specific id within a mixed cluster.
 */
function buildSingleItemTooltipPlan(
  view: EditorView,
  id: string,
  resolved: ReferenceClassification,
  store: BibStore,
): TooltipPlan {
  if (resolved.kind === "citation") {
    return buildCitationItemTooltipPlan(view, id, store);
  }

  if (resolved.kind === "crossref") {
    return buildCrossrefTooltipPlan(view, id, resolved.resolved);
  }

  const macros = view.state.field(mathMacrosField, false) ?? {};
  return {
    buildContent: () => {
      const container = createHoverPreviewContent();
      container.appendChild(
        createHoverPreviewHeader(
          unresolvedReferencePreviewLabel(id),
          macros,
          CSS.hoverPreviewUnresolved,
        ),
      );
      return container;
    },
    cacheScope: view.state,
    dependsOnBibliography: false,
    dependsOnMacros: true,
    key: `mixed:unresolved\0${id}`,
    mediaDependencies: EMPTY_LOCAL_MEDIA_DEPENDENCIES,
  };
}

// ── DOM walk helper ─────────────────────────────────────────────────────────

/**
 * Walk up from a DOM element to find the nearest ancestor (or self) with
 * a `data-ref-id` attribute. Returns the attribute value or null.
 *
 * Exported for testing: the DOM walk is the core logic that enables
 * per-item targeting, and can be tested without `elementFromPoint`.
 */
export function refIdFromElement(el: Element | null): string | null {
  let node: Element | null = el;
  while (node) {
    if (node.hasAttribute("data-ref-id")) {
      return node.getAttribute("data-ref-id");
    }
    node = node.parentElement;
  }
  return null;
}

// ── Hover logic: determine what to show ─────────────────────────────────────

/**
 * Determine tooltip content for a hovered element that belongs to a
 * cross-reference or citation widget.
 *
 * Returns a lazy tooltip plan, or null if no tooltip should show
 * (e.g., hovering on a separator text node).
 */
export function buildTooltipPlanForElement(
  view: EditorView,
  target: HTMLElement,
): TooltipPlan | null {
  const analysis = view.state.field(documentAnalysisField, false);
  const bibData = view.state.field(bibDataField, false);
  if (!analysis || !bibData) {
    return null;
  }
  const equationLabels = analysis.equationById;

  // Check if we're hovering a data-ref-id span (cluster item)
  const refId = refIdFromElement(target);

  // Find the widget container to determine if this is crossref or citation
  const widgetEl = findReferenceWidgetContainer(target);
  if (!widgetEl) return null;

  const ref = findRenderedReference(view, widgetEl);
  if (!ref) return null;

  const { store } = bibData;
  const presentation = createEditorReferencePresentationController(view.state, {
    store,
    formatter: bibData.formatter,
    equationLabels,
    surface: documentSurfacePolicy("hover-preview").referenceHostSurface,
  });
  const classifications = ref.ids.map((id) =>
    presentation.classify(id, ref.bracketed),
  );
  const hasCrossref = classifications.some((classification) => classification.kind === "crossref");
  const isCitationWidget = widgetEl.classList.contains(CSS.citation)
    || widgetEl.classList.contains("cf-citation-narrative");
  const allKnownBibliographyIds = ref.ids.length > 0 && ref.ids.every((id) => store.has(id));

  if (isCitationWidget && allKnownBibliographyIds) {
    if (refId && ref.ids.includes(refId)) {
      return buildCitationItemTooltipPlan(view, refId, store);
    }
    return buildCitationTooltipPlan(view, ref.ids, store);
  }

  // Single-id crossref
  if (ref.ids.length === 1 && classifications[0].kind === "crossref") {
    return buildCrossrefTooltipPlan(view, ref.ids[0], classifications[0].resolved);
  }

  // Multi-id cluster — per-item targeting via data-ref-id
  if (ref.ids.length > 1 && hasCrossref) {
    if (!refId) return null; // Hovering on separator — no tooltip
    const itemIndex = ref.ids.indexOf(refId);
    if (itemIndex < 0) return null;
    return buildSingleItemTooltipPlan(view, refId, classifications[itemIndex], store);
  }

  // Pure citation cluster
  if (classifications.some((classification) => classification.kind === "citation")) {
    // If we have a specific ref-id in the cluster, show single item
    if (refId && ref.ids.includes(refId)) {
      const itemIndex = ref.ids.indexOf(refId);
      return buildSingleItemTooltipPlan(view, refId, classifications[itemIndex], store);
    }
    return buildCitationTooltipPlan(view, ref.ids, store);
  }

  return null;
}
