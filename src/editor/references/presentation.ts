import { type EditorState, StateField, type Transaction } from "@codemirror/state";
import type { CslJsonItem } from "../../core/citations/csl-json";
import type {
  CitationCiteExtras,
  CitationFormatter,
  DocumentContext,
  LinkResolver,
} from "../../core/document-context-types";
import type { BlockCounterEntry } from "../../core/lib/file-system-types";
import { resolvedCrossrefFromReferenceTarget } from "../../core/reference-targets";
import { bibliographyEntryFor } from "../../core/references/citation-rendering";
import {
  classifyReferenceTarget as coreClassifyReferenceTarget,
  planReferencePresentation as corePlanReferencePresentation,
  createHostReferenceRouteResolver,
  type EquationEntry,
  type ReferencePresentationContext,
  type ReferencePresentationInput,
  type ReferencePresentationRoute,
  type ResolvedCrossref,
} from "../../core/references/presentation";
import type { NociteKeyLookup } from "../../core/references/nocite";
import {
  appendNociteRegistrationCluster,
  type CitationCollectionOptions,
  type CitationIdLookup,
  collectCitationMatches,
  collectCitationMatchesFromAnalysis,
  createReferenceIndexLocalTargetLookup,
  getCitationRegistrationKey,
} from "../citations/citation-matching";
import { formatCitationPreview } from "../citations/citation-preview";
import { documentContextFacet } from "../document-context";
import { sanitizeCslHtml } from "../lib/sanitize-csl-html";
import { documentPathFacet } from "../lib/types";
import type {
  DocumentAnalysis,
  DocumentSemantics,
  ReferenceSemantics,
} from "../semantics/document";
import {
  documentReferenceCatalogField,
  getEditorDocumentReferenceCatalog,
} from "../semantics/editor-reference-catalog";
import { frontmatterField } from "../state/frontmatter-state";
import {
  type DocumentReferenceCatalog,
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
  getPreferredDocumentReferenceTarget,
} from "../semantics/reference-catalog";
import { type BibStore, bibDataField } from "../state/bib-data";


export type {
  CrossrefKind,
  EquationEntry,
  ReferenceClassification,
  ReferenceClassificationOptions,
  ReferencePresentationClusteredCrossrefPart,
  ReferencePresentationContext,
  ReferencePresentationHostRefRoute,
  ReferencePresentationInput,
  ReferencePresentationMixedPart,
  ReferencePresentationRoute,
  ResolvedCrossref,
} from "../../core/references/presentation";
export {
  coreClassifyReferenceTarget as classifyReferenceTarget,
  corePlanReferencePresentation as planReferencePresentation,
};

export interface ReferencePresentationController extends ReferencePresentationContext {
  readonly linkResolver?: LinkResolver;
  readonly documentPath?: string;
  readonly surface?: string;
  getDisplayText(id: string): string;
  getPreviewText(id: string): string | undefined;
  planReference(input: ReferencePresentationInput): ReferencePresentationRoute | null;
  registerCitations(references: readonly ReferenceSemantics[]): void;
}

interface CachedCitationFormat {
  readonly display: string;
  readonly preview: string;
}

interface ReferencePresentationControllerOptions {
  readonly bibliography?: BibStore;
  readonly citationKeys?: CitationIdLookup;
  readonly cite?: (
    ids: readonly string[],
    locators: readonly (string | undefined)[],
    extras?: readonly (CitationCiteExtras | undefined)[],
  ) => string;
  readonly citeNarrative?: (id: string) => string;
  readonly getCitationPreview?: (id: string) => string | undefined;
  readonly registerCitations?: (references: readonly ReferenceSemantics[]) => void;
  readonly resolveCrossref: (id: string) => ResolvedCrossref | null;
  readonly documentContext?: DocumentContext;
  readonly documentPath?: string;
  readonly surface?: string;
}

interface PreviewReferencePresentationOptions {
  readonly bibliography?: BibStore;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly documentContext?: DocumentContext;
  readonly documentPath?: string;
  readonly formatter?: CitationFormatter | null;
  readonly referenceSemantics?: DocumentSemantics;
  readonly surface?: string;
}

let referencePresentationComputationCount = 0;

function formatCitationAuthor(item: CslJsonItem): string {
  const author = item.author?.[0];
  const base =
    author?.family
    ?? author?.literal
    ?? author?.given
    ?? item.publisher
    ?? item.id;

  return item.author && item.author.length > 1
    ? `${base} et al.`
    : base;
}

function formatCitationYear(item: CslJsonItem): string | undefined {
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? String(year) : undefined;
}

function formatCitationDisplay(item: CslJsonItem): string {
  const author = formatCitationAuthor(item);
  const year = formatCitationYear(item);
  return year ? `${author} ${year}` : author;
}

function getCachedCitationFormat(
  entries: Map<string, CachedCitationFormat>,
  store: BibStore | undefined,
  id: string,
): CachedCitationFormat | undefined {
  if (!store) {
    return undefined;
  }

  const entry = store.get(id);
  if (!entry) {
    return undefined;
  }

  const cached = entries.get(id);
  if (cached) {
    return cached;
  }

  referencePresentationComputationCount += 1;
  const next = {
    display: formatCitationDisplay(entry),
    preview: formatCitationPreview(entry),
  };
  entries.set(id, next);
  return next;
}

function plainTextFromCslHtml(html: string): string | undefined {
  const sanitized = sanitizeCslHtml(html);
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = sanitized;
    const text = container.textContent?.replace(/\s+/g, " ").trim();
    return text || undefined;
  }

  const text = sanitized.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function getDocumentContextCitationPreview(
  context: DocumentContext | undefined,
  id: string,
): string | undefined {
  if (!context?.citationFormatter || !context.citationKeys?.has(id)) {
    return undefined;
  }
  const entry = bibliographyEntryFor(context.citationFormatter, id);
  return entry ? plainTextFromCslHtml(entry.html) : undefined;
}

function meaningfulCitationPreview(preview: string | undefined): string | undefined {
  if (!preview || !/[A-Za-z0-9]/.test(preview)) {
    return undefined;
  }
  return preview;
}

export function resolveCatalogCrossref(
  catalog: DocumentReferenceCatalog,
  id: string,
  equationLabels?: ReadonlyMap<string, EquationEntry>,
): ResolvedCrossref | null {
  const target = getPreferredDocumentReferenceTarget(catalog, id);

  if (target?.kind === "block") {
    return resolvedCrossrefFromReferenceTarget(target);
  }

  const eqEntry = equationLabels?.get(id)
    ?? (target?.kind === "equation" && target.ordinal !== undefined
      ? { id, number: target.ordinal }
      : undefined);
  if (eqEntry) {
    return {
      kind: "equation",
      label: formatEquationReferenceLabel(eqEntry.number),
      number: eqEntry.number,
    };
  }

  if (target?.kind === "heading") {
    return resolvedCrossrefFromReferenceTarget(target);
  }

  return null;
}

function createReferencePresentationController(
  options: ReferencePresentationControllerOptions,
): ReferencePresentationController {
  const citationEntries = new Map<string, CachedCitationFormat>();
  const cite = options.cite ?? (() => "");
  const citeNarrative = options.citeNarrative ?? ((id: string) => id);
  const resolveHostReference = createHostReferenceRouteResolver({
    resolver: options.documentContext?.refResolver,
    resolveCrossref: options.resolveCrossref,
    documentPath: options.documentPath,
    surface: options.surface,
    sanitizeContent: sanitizeCslHtml,
  });

  const controller: ReferencePresentationController = {
    linkResolver: options.documentContext?.linkResolver,
    documentPath: options.documentPath,
    surface: options.surface,
    resolveHostReference,

    classify(id, preferCitation) {
      return coreClassifyReferenceTarget(options.resolveCrossref, id, {
        bibliography: options.citationKeys,
        preferCitation,
      });
    },

    cite(ids, locators, extras) {
      return cite(ids, locators, extras);
    },

    citeNarrative(id) {
      return citeNarrative(id);
    },

    getDisplayText(id) {
      const resolved = options.resolveCrossref(id);
      if (resolved) {
        return resolved.label;
      }

      return getCachedCitationFormat(citationEntries, options.bibliography, id)?.display ?? id;
    },

    getPreviewText(id) {
      return options.getCitationPreview?.(id)
        ?? meaningfulCitationPreview(
          getCachedCitationFormat(citationEntries, options.bibliography, id)?.preview,
        )
        ?? getDocumentContextCitationPreview(options.documentContext, id);
    },

    planReference(input) {
      return corePlanReferencePresentation(controller, input);
    },

    registerCitations(references) {
      options.registerCitations?.(references);
    },
  };

  return controller;
}

export function createCatalogReferencePresentationController(
  catalog: DocumentReferenceCatalog,
  options: Omit<ReferencePresentationControllerOptions, "resolveCrossref"> & {
    readonly equationLabels?: ReadonlyMap<string, EquationEntry>;
  } = {},
): ReferencePresentationController {
  return createReferencePresentationController({
    ...options,
    resolveCrossref: (id) => resolveCatalogCrossref(catalog, id, options.equationLabels),
  });
}

/**
 * Normalized frontmatter `nocite` keys, or empty when the frontmatter field
 * is absent. Callers pass this to
 * {@link ensureEditorReferencePresentationCitationsRegistered} so the
 * presentation path registers the same trailing nocite cluster as the
 * bibliography widget.
 */
export function getEditorNociteConfig(state: EditorState): readonly string[] {
  return state.field(frontmatterField, false)?.config.nocite ?? [];
}

/**
 * Ensure the current document's citation clusters have been registered with
 * the attached `CitationFormatter` (no-op if no formatter is attached).
 *
 * When frontmatter `nocite` keys are supplied, the same trailing nocite
 * cluster the bibliography widget registers is appended, so both paths
 * compute the same `citationRegistrationKey` and stop re-registering each
 * other's clusters.
 */
export function ensureEditorReferencePresentationCitationsRegistered(
  analysis: DocumentAnalysis,
  citationKeys: CitationIdLookup & Partial<NociteKeyLookup>,
  formatter: CitationFormatter | null,
  nocite?: readonly string[],
): void {
  if (!formatter) return;
  const matches = collectCitationMatchesFromAnalysis(analysis, citationKeys);
  if (nocite && nocite.length > 0) {
    appendNociteRegistrationCluster(
      matches,
      nocite,
      {
        has: (id) => citationKeys.has(id),
        keys: () => citationKeys.keys?.() ?? [],
      },
      { isLocalTarget: createReferenceIndexLocalTargetLookup(analysis.referenceIndex) },
    );
  }
  const registrationKey = getCitationRegistrationKey(matches);
  if (formatter.citationRegistrationKey === registrationKey) return;
  formatter.registerCitations(matches);
}

export function createEditorReferencePresentationController(
  state: EditorState,
  options: {
    readonly store?: BibStore;
    readonly formatter?: CitationFormatter | null;
    readonly equationLabels?: ReadonlyMap<string, EquationEntry>;
    readonly surface?: string;
  } = {},
): ReferencePresentationController {
  const bibliography = state.field(bibDataField, false);
  const store = options.store ?? bibliography?.store;
  const documentContext = state.facet(documentContextFacet);
  const localFormatter = options.formatter !== undefined
    ? options.formatter
    : bibliography?.formatter ?? null;
  const formatter = localFormatter ?? documentContext.citationFormatter ?? null;
  const citationKeys = formatter === documentContext.citationFormatter
    ? documentContext.citationKeys
    : undefined;
  const documentPath = state.facet(documentPathFacet) || undefined;

  return createCatalogReferencePresentationController(
    getEditorDocumentReferenceCatalog(state),
    {
      bibliography: store,
      citationKeys,
      documentContext,
      documentPath,
      equationLabels: options.equationLabels,
      cite: (ids, locators, extras) => formatter?.cite([...ids], [...locators], extras) ?? "",
      citeNarrative: (id) => formatter?.citeNarrative(id) ?? id,
      surface: options.surface ?? "editor",
      registerCitations: (references) => {
        if (!citationKeys || !formatter) return;
        const catalog = getEditorDocumentReferenceCatalog(state);
        const matches = collectCitationMatches(references, citationKeys, {
          isLocalTarget: (id) =>
            resolveCatalogCrossref(catalog, id, options.equationLabels) !== null,
        });
        formatter.registerCitations(matches);
      },
    },
  );
}

function resolvePreviewCrossref(
  id: string,
  options: PreviewReferencePresentationOptions,
): ResolvedCrossref | null {
  const block = options.blockCounters?.get(id);
  if (block) {
    return {
      kind: "block",
      label: formatBlockReferenceLabel(block.title, block.number),
      number: block.number,
    };
  }

  const semantics = options.referenceSemantics;
  const equation = semantics?.equationById.get(id);
  if (equation) {
    return {
      kind: "equation",
      label: formatEquationReferenceLabel(equation.number),
      number: equation.number,
    };
  }

  const heading = semantics?.headings.find((entry) => entry.id === id);
  if (heading) {
    return {
      kind: "heading",
      label: formatHeadingReferenceLabel(heading),
      title: heading.text,
    };
  }

  return null;
}

function getPreviewCitationOptions(
  options: PreviewReferencePresentationOptions,
): CitationCollectionOptions {
  return {
    isLocalTarget: (id) => resolvePreviewCrossref(id, options) !== null,
  };
}

export function createPreviewReferencePresentationController(
  options: PreviewReferencePresentationOptions,
): ReferencePresentationController {
  const formatter = (options.formatter ?? options.documentContext?.citationFormatter) ?? null;
  const citationKeys = formatter === options.documentContext?.citationFormatter
    ? options.documentContext?.citationKeys
    : undefined;
  return createReferencePresentationController({
    bibliography: options.bibliography,
    citationKeys,
    documentContext: options.documentContext,
    documentPath: options.documentPath,
    surface: options.surface ?? "editor-widget",
    cite: (ids, locators, extras) => {
      const rendered = formatter?.cite([...ids], [...locators], extras);
      if (rendered) return rendered;
      return `(${ids.map((id, index) => locators[index] ? `${id}, ${locators[index]}` : id).join("; ")})`;
    },
    citeNarrative: (id) => (
      formatter && citationKeys?.has(id)
        ? formatter.citeNarrative(id)
        : id
    ),
    registerCitations: (references) => {
      if (!citationKeys || !formatter) return;
      const matches = collectCitationMatches(
        references,
        citationKeys,
        getPreviewCitationOptions(options),
      );
      formatter.registerCitations(matches);
    },
    resolveCrossref: (id) => resolvePreviewCrossref(id, options),
  });
}

function createReferencePresentationModel(
  state: EditorState,
): ReferencePresentationController {
  return createEditorReferencePresentationController(state);
}

function referencePresentationDependenciesChanged(tr: Transaction): boolean {
  return tr.docChanged
    || tr.reconfigured
    || tr.startState.field(documentReferenceCatalogField, false)
      !== tr.state.field(documentReferenceCatalogField, false)
    || tr.startState.field(bibDataField, false) !== tr.state.field(bibDataField, false)
    || tr.startState.facet(documentContextFacet) !== tr.state.facet(documentContextFacet)
    || tr.startState.facet(documentPathFacet) !== tr.state.facet(documentPathFacet);
}

export const referencePresentationField = StateField.define<ReferencePresentationController>({
  create(state) {
    return createReferencePresentationModel(state);
  },

  update(value, tr) {
    return referencePresentationDependenciesChanged(tr)
      ? createReferencePresentationModel(tr.state)
      : value;
  },
});

export function getReferencePresentationModel(
  state: EditorState,
): ReferencePresentationController {
  return state.field(referencePresentationField, false) ?? createReferencePresentationModel(state);
}

export function getReferencePresentationComputationCountForTest(): number {
  return referencePresentationComputationCount;
}

export function resetReferencePresentationComputationCountForTest(): void {
  referencePresentationComputationCount = 0;
}
