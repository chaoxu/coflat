import {
  formatBlockReferenceLabel,
  formatEquationReferenceLabel,
  formatHeadingReferenceLabel,
} from "./references/format";
import type { ResolvedCrossref } from "./references/presentation";

export type DocumentReferenceTargetKind = "block" | "equation" | "heading";

export interface BlockReferenceTargetInput {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly blockType: string;
  readonly title?: string;
  readonly displayTitle?: string;
  readonly number?: number;
  readonly line?: number;
}

export interface EquationReferenceTargetInput {
  readonly from: number;
  readonly to: number;
  readonly id: string;
  readonly number: number;
  readonly latex: string;
  readonly line?: number;
}

export interface HeadingReferenceTargetInput {
  readonly from: number;
  readonly to: number;
  readonly id?: string;
  readonly number: string;
  readonly text: string;
  readonly line?: number;
}

export interface DocumentReferenceTarget {
  readonly id?: string;
  readonly kind: DocumentReferenceTargetKind;
  readonly from: number;
  readonly to: number;
  readonly line?: number;
  readonly displayLabel: string;
  readonly number?: string;
  readonly ordinal?: number;
  readonly title?: string;
  readonly text?: string;
  readonly blockType?: string;
}

export interface DocumentReferenceTargetIndexes {
  readonly targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
  readonly uniqueTargetById: ReadonlyMap<string, DocumentReferenceTarget>;
  readonly duplicatesById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>;
}

export interface DocumentReferenceTargetCollection extends DocumentReferenceTargetIndexes {
  readonly targets: readonly DocumentReferenceTarget[];
}

export interface DocumentReferenceTargetPositionMapper {
  mapPos(pos: number, assoc?: number): number;
}

function lineField(line: number | undefined): { line?: number } {
  return line === undefined ? {} : { line };
}

export function blockReferenceTarget(input: BlockReferenceTargetInput): DocumentReferenceTarget {
  return {
    id: input.id,
    kind: "block",
    from: input.from,
    to: input.to,
    ...lineField(input.line),
    displayLabel: formatBlockReferenceLabel(
      input.displayTitle ?? input.blockType,
      input.number,
    ),
    number: input.number === undefined ? undefined : String(input.number),
    ordinal: input.number,
    title: input.title,
    blockType: input.blockType,
  };
}

export function equationReferenceTarget(input: EquationReferenceTargetInput): DocumentReferenceTarget {
  return {
    id: input.id,
    kind: "equation",
    from: input.from,
    to: input.to,
    ...lineField(input.line),
    displayLabel: formatEquationReferenceLabel(input.number),
    number: String(input.number),
    ordinal: input.number,
    text: input.latex,
  };
}

export function headingReferenceTarget(input: HeadingReferenceTargetInput): DocumentReferenceTarget {
  return {
    id: input.id,
    kind: "heading",
    from: input.from,
    to: input.to,
    ...lineField(input.line),
    displayLabel: formatHeadingReferenceLabel(input),
    number: input.number || undefined,
    title: input.text,
    text: input.text,
  };
}

export function sortDocumentReferenceTargets(
  targets: readonly DocumentReferenceTarget[],
): DocumentReferenceTarget[] {
  return [...targets].sort((left, right) => (left.from - right.from) || (left.to - right.to));
}

export function buildReferenceTargetIndexes(
  targets: readonly DocumentReferenceTarget[],
): DocumentReferenceTargetIndexes {
  const targetsById = new Map<string, DocumentReferenceTarget[]>();
  const uniqueTargetById = new Map<string, DocumentReferenceTarget>();
  const duplicatesById = new Map<string, readonly DocumentReferenceTarget[]>();

  for (const target of targets) {
    if (!target.id) continue;
    const bucket = targetsById.get(target.id);
    if (!bucket) {
      targetsById.set(target.id, [target]);
      uniqueTargetById.set(target.id, target);
      continue;
    }

    if (bucket.length === 1) {
      uniqueTargetById.delete(target.id);
      duplicatesById.set(target.id, bucket);
    }

    bucket.push(target);
  }

  return {
    targetsById,
    uniqueTargetById,
    duplicatesById,
  };
}

export function buildDocumentReferenceTargetCollection(
  targets: readonly DocumentReferenceTarget[],
): DocumentReferenceTargetCollection {
  const sortedTargets = sortDocumentReferenceTargets(targets);
  return {
    targets: sortedTargets,
    ...buildReferenceTargetIndexes(sortedTargets),
  };
}

export function compareDocumentReferenceTargetPreference(
  left: Pick<DocumentReferenceTarget, "kind">,
  right: Pick<DocumentReferenceTarget, "kind">,
): number {
  const rank = (kind: DocumentReferenceTargetKind) => {
    switch (kind) {
      case "block":
        return 0;
      case "equation":
        return 1;
      case "heading":
        return 2;
    }
  };
  return rank(left.kind) - rank(right.kind);
}

export function shouldReplacePreferredDocumentReferenceTarget(
  candidate: DocumentReferenceTarget,
  current: DocumentReferenceTarget | undefined,
): boolean {
  return !current || compareDocumentReferenceTargetPreference(candidate, current) < 0;
}

export function setPreferredDocumentReferenceTarget(
  targetsById: Map<string, DocumentReferenceTarget>,
  id: string,
  target: DocumentReferenceTarget,
): boolean {
  if (!shouldReplacePreferredDocumentReferenceTarget(target, targetsById.get(id))) {
    return false;
  }
  targetsById.set(id, target);
  return true;
}

export function getPreferredDocumentReferenceTarget(
  targetsById: ReadonlyMap<string, readonly DocumentReferenceTarget[]>,
  id: string,
): DocumentReferenceTarget | undefined {
  const targets = targetsById.get(id);
  if (!targets) return undefined;
  return targets.reduce<DocumentReferenceTarget | undefined>((preferred, target) =>
    shouldReplacePreferredDocumentReferenceTarget(target, preferred)
      ? target
      : preferred,
  undefined);
}

export function mapDocumentReferenceTarget(
  target: DocumentReferenceTarget,
  mapper: DocumentReferenceTargetPositionMapper,
): DocumentReferenceTarget {
  const from = mapper.mapPos(target.from, 1);
  const to = Math.max(from, mapper.mapPos(target.to, -1));
  if (from === target.from && to === target.to) {
    return target;
  }
  return {
    ...target,
    from,
    to,
  };
}

export function mapDocumentReferenceTargets(
  targets: readonly DocumentReferenceTarget[],
  mapper: DocumentReferenceTargetPositionMapper,
): readonly DocumentReferenceTarget[] {
  let changed = false;
  const mapped = targets.map((target) => {
    const next = mapDocumentReferenceTarget(target, mapper);
    if (next !== target) changed = true;
    return next;
  });
  return changed ? mapped : targets;
}

export function resolvedCrossrefFromReferenceTarget(
  target: DocumentReferenceTarget,
): ResolvedCrossref | null {
  if (target.kind === "block") {
    return {
      kind: "block",
      label: target.displayLabel,
      title: target.title,
      number: target.ordinal,
    };
  }

  if (target.kind === "equation") {
    if (target.ordinal === undefined) return null;
    return {
      kind: "equation",
      label: formatEquationReferenceLabel(target.ordinal),
      number: target.ordinal,
    };
  }

  return {
    kind: "heading",
    label: target.displayLabel,
    title: target.title,
  };
}
