import { StateField, type EditorState, type Transaction } from "@codemirror/state";
import type { CslJsonItem } from "../../core/citations/csl-json";
import { formatCitationPreview } from "../citations/citation-preview";
import {
  collectCitationMatches,
  collectCitationMatchesFromAnalysis,
  getCitationRegistrationKey,
  type CitationCollectionOptions,
} from "../citations/citation-matching";
import type { CitationFormatter } from "../document-context";
import type { BlockCounterEntry } from "../lib/types";
import type {
  DocumentAnalysis,
  DocumentSemantics,
  ReferenceSemantics,
} from "../semantics/document";
import {
  documentReferenceCatalogField,
  getEditorDocumentReferenceCatalog,
} from "../semantics/editor-reference-catalog";
import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
  getPreferredDocumentReferenceTarget,
  type DocumentReferenceCatalog,
} from "../semantics/reference-catalog";
import { type BibStore, bibDataField } from "../state/bib-data";

export type CrossrefKind = "block" | "heading" | "equation" | "citation" | "unresolved";

export interface ResolvedCrossref {
  readonly kind: CrossrefKind;
  readonly label: string;
  readonly number?: number;
  readonly title?: string;
}

export interface EquationEntry {
  readonly id: string;
  readonly number: number;
}

type ReferenceLookup = Pick<ReadonlyMap<string, unknown>, "has">;

export type ReferenceClassification =
  | { readonly kind: "crossref"; readonly resolved: ResolvedCrossref }
  | { readonly kind: "citation"; readonly id: string }
  | { readonly kind: "unresolved"; readonly id: string };

export interface ReferencePresentationContext {
  classify: (id: string, preferCitation: boolean) => ReferenceClassification;
  cite: (
    ids: readonly string[],
    locators: readonly (string | undefined)[],
  ) => string;
  citeNarrative: (id: string) => string;
}

export interface ReferencePresentationController extends ReferencePresentationContext {
  getDisplayText(id: string): string;
  getPreviewText(id: string): string | undefined;
  planReference(input: ReferencePresentationInput): ReferencePresentationRoute | null;
  registerCitations(references: readonly ReferenceSemantics[]): void;
}

export interface ReferencePresentationInput {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
  readonly raw: string;
}

export interface ReferencePresentationCitationPart {
  readonly kind: "citation";
  readonly id: string;
  readonly text: string;
}

export interface ReferencePresentationCrossrefPart {
  readonly kind: "crossref";
  readonly id: string;
  readonly text: string;
}

export interface ReferencePresentationClusteredCrossrefPart {
  readonly id: string;
  readonly text: string;
  readonly unresolved?: boolean;
}

export type ReferencePresentationMixedPart =
  | ReferencePresentationCitationPart
  | ReferencePresentationCrossrefPart;

export type ReferencePresentationRoute =
  | { readonly kind: "citation"; readonly rendered: string; readonly ids: readonly string[]; readonly narrative: boolean }
  | { readonly kind: "mixed-cluster"; readonly parts: readonly ReferencePresentationMixedPart[]; readonly raw: string }
  | { readonly kind: "crossref"; readonly resolved: ResolvedCrossref; readonly raw: string }
  | { readonly kind: "clustered-crossref"; readonly parts: readonly ReferencePresentationClusteredCrossrefPart[]; readonly raw: string }
  | { readonly kind: "unresolved"; readonly raw: string };

export interface ReferenceClassificationOptions {
  readonly bibliography?: ReferenceLookup;
  readonly equationLabels?: ReadonlyMap<string, EquationEntry>;
  readonly preferCitation?: boolean;
}

interface CachedCitationFormat {
  readonly display: string;
  readonly preview: string;
}

interface ReferencePresentationControllerOptions {
  readonly bibliography?: BibStore;
  readonly cite?: (
    ids: readonly string[],
    locators: readonly (string | undefined)[],
  ) => string;
  readonly citeNarrative?: (id: string) => string;
  readonly getCitationPreview?: (id: string) => string | undefined;
  readonly registerCitations?: (references: readonly ReferenceSemantics[]) => void;
  readonly resolveCrossref: (id: string) => ResolvedCrossref | null;
}

interface PreviewReferencePresentationOptions {
  readonly bibliography?: BibStore;
  readonly blockCounters?: ReadonlyMap<string, BlockCounterEntry>;
  readonly formatter?: CitationFormatter | null;
  readonly referenceSemantics?: DocumentSemantics;
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

function stripOuterParens(text: string): string {
  return text.startsWith("(") && text.endsWith(")")
    ? text.slice(1, -1)
    : text;
}

function citeSingle(
  context: Pick<ReferencePresentationContext, "cite">,
  id: string,
  locator: string | undefined,
): string {
  return context.cite([id], locator === undefined ? [] : [locator]);
}

export function resolveCatalogCrossref(
  catalog: DocumentReferenceCatalog,
  id: string,
  equationLabels?: ReadonlyMap<string, EquationEntry>,
): ResolvedCrossref | null {
  const target = getPreferredDocumentReferenceTarget(catalog, id);

  if (target?.kind === "block") {
    return {
      kind: "block",
      label: target.displayLabel,
      number: target.ordinal,
    };
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
    return {
      kind: "heading",
      label: target.displayLabel,
      title: target.title,
    };
  }

  return null;
}

export function classifyReferenceTarget(
  resolveCrossref: (id: string) => ResolvedCrossref | null,
  id: string,
  options: Pick<ReferenceClassificationOptions, "bibliography"> = {},
): ReferenceClassification {
  const resolved = resolveCrossref(id);
  if (resolved) {
    return { kind: "crossref", resolved };
  }

  if (options.bibliography?.has(id) ?? false) {
    return { kind: "citation", id };
  }

  return { kind: "unresolved", id };
}

export function planReferencePresentation(
  context: ReferencePresentationContext,
  input: ReferencePresentationInput,
): ReferencePresentationRoute | null {
  const classifications = input.ids.map((id) =>
    context.classify(id, input.bracketed),
  );

  if (!input.bracketed) {
    const resolved = classifications[0];
    if (resolved.kind === "crossref") {
      return { kind: "crossref", resolved: resolved.resolved, raw: input.raw };
    }
    if (resolved.kind === "citation") {
      return {
        kind: "citation",
        rendered: context.citeNarrative(input.ids[0]),
        ids: input.ids,
        narrative: true,
      };
    }
    return null;
  }

  const hasCitation = classifications.some((classification) => classification.kind === "citation");
  const allCitations = hasCitation
    && classifications.every((classification) => classification.kind === "citation");

  if (allCitations) {
    return {
      kind: "citation",
      rendered: context.cite(input.ids, input.locators),
      ids: input.ids,
      narrative: false,
    };
  }

  if (hasCitation) {
    const parts: ReferencePresentationMixedPart[] = input.ids.map((id, index) => {
      const classification = classifications[index];
      if (classification.kind === "citation") {
        return {
          kind: "citation" as const,
          id,
          text: stripOuterParens(citeSingle(context, id, input.locators[index])),
        };
      }
      return {
        kind: "crossref" as const,
        id,
        text: classification.kind === "crossref" ? classification.resolved.label : id,
      };
    });
    return { kind: "mixed-cluster", parts, raw: input.raw };
  }

  if (input.ids.length === 1) {
    const resolved = classifications[0];
    return resolved.kind === "crossref"
      ? { kind: "crossref", resolved: resolved.resolved, raw: input.raw }
      : { kind: "unresolved", raw: input.raw };
  }

  const parts = classifications.map((classification, index) => {
    if (classification.kind === "crossref") {
      return {
        id: input.ids[index],
        text: classification.resolved.label,
      };
    }
    return {
      id: input.ids[index],
      text: input.ids[index],
      unresolved: true,
    };
  });

  return parts.some((part) => !part.unresolved)
    ? { kind: "clustered-crossref", parts, raw: input.raw }
    : { kind: "unresolved", raw: input.raw };
}

function createReferencePresentationController(
  options: ReferencePresentationControllerOptions,
): ReferencePresentationController {
  const citationEntries = new Map<string, CachedCitationFormat>();
  const cite = options.cite ?? (() => "");
  const citeNarrative = options.citeNarrative ?? ((id: string) => id);

  const controller: ReferencePresentationController = {
    classify(id, _preferCitation) {
      return classifyReferenceTarget(options.resolveCrossref, id, {
        bibliography: options.bibliography,
      });
    },

    cite(ids, locators) {
      return cite(ids, locators);
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
        ?? getCachedCitationFormat(citationEntries, options.bibliography, id)?.preview;
    },

    planReference(input) {
      return planReferencePresentation(controller, input);
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
 * Ensure the current document's citation clusters have been registered with
 * the attached `CitationFormatter` (no-op if no formatter is attached).
 */
export function ensureEditorReferencePresentationCitationsRegistered(
  analysis: DocumentAnalysis,
  store: BibStore,
  formatter: CitationFormatter | null,
): void {
  if (!formatter) return;
  const matches = collectCitationMatchesFromAnalysis(analysis, store);
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
  } = {},
): ReferencePresentationController {
  const bibliography = state.field(bibDataField, false);
  const store = options.store ?? bibliography?.store;
  const formatter =
    options.formatter !== undefined ? options.formatter : bibliography?.formatter ?? null;

  return createCatalogReferencePresentationController(
    getEditorDocumentReferenceCatalog(state),
    {
      bibliography: store,
      equationLabels: options.equationLabels,
      cite: (ids, locators) => formatter?.cite([...ids], [...locators]) ?? "",
      citeNarrative: (id) => formatter?.citeNarrative(id) ?? id,
      registerCitations: (references) => {
        if (!store || !formatter) return;
        const catalog = getEditorDocumentReferenceCatalog(state);
        const matches = collectCitationMatches(references, store, {
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
  const formatter = options.formatter ?? null;
  return createReferencePresentationController({
    bibliography: options.bibliography,
    cite: (ids, locators) => {
      const rendered = formatter?.cite([...ids], [...locators]);
      if (rendered) return rendered;
      return `(${ids.map((id, index) => locators[index] ? `${id}, ${locators[index]}` : id).join("; ")})`;
    },
    citeNarrative: (id) => (
      formatter && options.bibliography?.has(id)
        ? formatter.citeNarrative(id)
        : id
    ),
    registerCitations: (references) => {
      if (!options.bibliography || !formatter) return;
      const matches = collectCitationMatches(
        references,
        options.bibliography,
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
    || tr.startState.field(documentReferenceCatalogField, false)
      !== tr.state.field(documentReferenceCatalogField, false)
    || tr.startState.field(bibDataField, false) !== tr.state.field(bibDataField, false);
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
