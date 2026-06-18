import type { ChangeDesc } from "@codemirror/state";
import type { CrossrefReferenceEntry } from "../../core/references/model";
import type {
  DocumentAnalysis,
  ReferenceSemantics,
} from "./document";
import {
  blockReferenceTarget,
  buildReferenceTargetIndexes,
  equationReferenceTarget,
  getPreferredDocumentReferenceTarget as getPreferredTarget,
  headingReferenceTarget,
  sortDocumentReferenceTargets,
  type BlockReferenceTargetInput,
  type DocumentReferenceTarget,
} from "../../core/reference-targets";

export {
  blockReferenceTarget,
  equationReferenceTarget,
  headingReferenceTarget,
} from "../../core/reference-targets";
export {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "../../core/references/format";
export type {
  BlockReferenceTargetInput,
  DocumentReferenceTarget,
  DocumentReferenceTargetKind,
} from "../../core/reference-targets";

export interface DocumentReferenceCatalog {
  readonly targets: readonly DocumentReferenceTarget[];
  readonly targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly uniqueTargetById: ReadonlyMap<string, DocumentReferenceTarget>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly references: readonly ReferenceSemantics[];
}

export interface DocumentReferenceCatalogOptions {
  readonly blocks?: readonly BlockReferenceTargetInput[];
}

function buildDefaultBlockReferenceTargetInputs(
  analysis: DocumentAnalysis,
): BlockReferenceTargetInput[] {
  const blocks: BlockReferenceTargetInput[] = [];
  for (const div of analysis.fencedDivs) {
    if (!div.primaryClass) continue;
    blocks.push({
      from: div.from,
      to: div.to,
      id: div.id,
      blockType: div.primaryClass,
      title: div.title,
    });
  }
  return blocks;
}

function getHeadingReferenceEntry(
  analysis: DocumentAnalysis,
  id: string,
): CrossrefReferenceEntry | undefined {
  const entry = analysis.referenceIndex.get(id);
  return entry?.type === "crossref" && entry.targetKind === "heading"
    ? entry
    : undefined;
}

function buildBlockTargets(
  blocks: readonly BlockReferenceTargetInput[],
): DocumentReferenceTarget[] {
  return blocks.map(blockReferenceTarget);
}

function buildEquationTargets(
  analysis: DocumentAnalysis,
): DocumentReferenceTarget[] {
  return analysis.equations.map(equationReferenceTarget);
}

function buildHeadingTargets(
  analysis: DocumentAnalysis,
): DocumentReferenceTarget[] {
  return analysis.headings.map((heading) => {
    const entry = heading.id ? getHeadingReferenceEntry(analysis, heading.id) : undefined;
    const target = headingReferenceTarget(heading);
    if (!entry) return target;
    return {
      ...target,
      displayLabel: entry.display,
      number: entry.number ?? target.number,
      title: entry.title ?? target.title,
      text: entry.text ?? target.text,
    };
  });
}

export function buildDocumentReferenceCatalog(
  analysis: DocumentAnalysis,
  options: DocumentReferenceCatalogOptions = {},
): DocumentReferenceCatalog {
  const targets = sortDocumentReferenceTargets([
    ...buildBlockTargets(options.blocks ?? buildDefaultBlockReferenceTargetInputs(analysis)),
    ...buildEquationTargets(analysis),
    ...buildHeadingTargets(analysis),
  ]);

  const {
    targetsById,
    uniqueTargetById,
    duplicatesById,
  } = buildReferenceTargetIndexes(targets);
  return {
    targets,
    targetsById,
    uniqueTargetById,
    duplicatesById,
    references: analysis.references,
  };
}

function mapDocumentReferenceTarget(
  target: DocumentReferenceTarget,
  changes: ChangeDesc,
): DocumentReferenceTarget {
  const from = changes.mapPos(target.from, 1);
  const to = Math.max(from, changes.mapPos(target.to, -1));
  if (from === target.from && to === target.to) {
    return target;
  }
  return {
    ...target,
    from,
    to,
  };
}

export function mapDocumentReferenceCatalog(
  catalog: DocumentReferenceCatalog,
  changes: ChangeDesc,
  references = catalog.references,
): DocumentReferenceCatalog {
  let targetsChanged = false;
  const targets: DocumentReferenceTarget[] = [];
  const targetsById = new Map<string, DocumentReferenceTarget[]>();
  const uniqueTargetById = new Map<string, DocumentReferenceTarget>();
  const duplicatesById = new Map<string, readonly DocumentReferenceTarget[]>();

  for (const target of catalog.targets) {
    const next = mapDocumentReferenceTarget(target, changes);
    if (next !== target) targetsChanged = true;
    targets.push(next);

    if (!next.id) continue;
    const bucket = targetsById.get(next.id);
    if (!bucket) {
      targetsById.set(next.id, [next]);
      uniqueTargetById.set(next.id, next);
      continue;
    }
    if (bucket.length === 1) {
      uniqueTargetById.delete(next.id);
      duplicatesById.set(next.id, bucket);
    }
    bucket.push(next);
  }

  if (!targetsChanged && references === catalog.references) {
    return catalog;
  }

  if (!targetsChanged) {
    return {
      ...catalog,
      references,
    };
  }

  return {
    targets,
    targetsById,
    uniqueTargetById,
    duplicatesById,
    references,
  };
}

export function getPreferredDocumentReferenceTarget(
  catalog: DocumentReferenceCatalog,
  id: string,
): DocumentReferenceTarget | undefined {
  return getPreferredTarget(catalog.targetsById, id);
}
