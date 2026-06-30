import { buildFootnotePlan } from "../../../../core/semantics/footnote-plan";
import type {
  FootnoteDefinition,
  FootnoteReference,
  FootnoteSemantics,
  OrderedFootnoteEntry,
} from "../../document-model";
import {
  type PositionMapper,
  type RangeLike,
  rangesOverlap,
  replaceOverlappingRanges,
} from "../merge-utils";
import type { DirtyWindow, SemanticDelta } from "../types";
import type { StructuralWindowExtraction } from "../window-extractor";

export interface FootnoteSlice extends FootnoteSemantics {
  readonly definitions: readonly FootnoteDefinition[];
  readonly numberById: ReadonlyMap<string, number>;
  readonly orderedEntries: readonly OrderedFootnoteEntry[];
}

export interface DirtyFootnoteWindowExtraction {
  readonly window: DirtyWindow;
  readonly structural: Pick<StructuralWindowExtraction, "footnoteRefs" | "footnoteDefs">;
}

function deltaMapper(delta: Pick<SemanticDelta, "mapOldToNew">): PositionMapper {
  return {
    mapPos(pos, assoc = -1) {
      return delta.mapOldToNew(pos, assoc);
    },
  };
}

export function mapFootnoteReference(
  value: FootnoteReference,
  changes: PositionMapper,
): FootnoteReference {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  if (from === value.from && to === value.to) {
    return value;
  }
  return {
    id: value.id,
    from,
    to,
  };
}

export function mapFootnoteDefinition(
  value: FootnoteDefinition,
  changes: PositionMapper,
): FootnoteDefinition {
  const from = changes.mapPos(value.from, 1);
  const to = Math.max(from, changes.mapPos(value.to, -1));
  const labelFrom = changes.mapPos(value.labelFrom, 1);
  const labelTo = Math.max(labelFrom, changes.mapPos(value.labelTo, -1));
  const bodyFrom = changes.mapPos(value.bodyFrom, 1);
  const bodyTo = Math.max(bodyFrom, changes.mapPos(value.bodyTo, -1));

  if (
    from === value.from
    && to === value.to
    && labelFrom === value.labelFrom
    && labelTo === value.labelTo
    && bodyFrom === value.bodyFrom
    && bodyTo === value.bodyTo
  ) {
    return value;
  }

  return {
    id: value.id,
    from,
    to,
    content: value.content,
    bodyFrom,
    bodyTo,
    labelFrom,
    labelTo,
  };
}

function mapFootnoteReferences(
  values: readonly FootnoteReference[],
  changes: PositionMapper,
): readonly FootnoteReference[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapFootnoteReference(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function mapFootnoteDefinitions(
  values: readonly FootnoteDefinition[],
  changes: PositionMapper,
): readonly FootnoteDefinition[] {
  let changed = false;
  const mapped = values.map((value) => {
    const next = mapFootnoteDefinition(value, changes);
    if (next !== value) changed = true;
    return next;
  });
  return changed ? mapped : values;
}

function sameFootnoteReference(
  left: FootnoteReference,
  right: FootnoteReference,
): boolean {
  return left.id === right.id && left.from === right.from && left.to === right.to;
}

function sameFootnoteDefinition(
  left: FootnoteDefinition,
  right: FootnoteDefinition,
): boolean {
  return (
    left.id === right.id
    && left.from === right.from
    && left.to === right.to
    && left.content === right.content
    && left.bodyFrom === right.bodyFrom
    && left.bodyTo === right.bodyTo
    && left.labelFrom === right.labelFrom
    && left.labelTo === right.labelTo
  );
}

function replacementWindow<T extends RangeLike>(
  window: RangeLike,
  replacements: readonly T[],
): RangeLike {
  if (replacements.length === 0) return window;
  return {
    from: Math.min(window.from, replacements[0].from),
    to: Math.max(window.to, replacements[replacements.length - 1].to),
  };
}

function reuseEquivalentReplacements<T>(
  existing: readonly T[],
  replacements: readonly T[],
  isEquivalent: (left: T, right: T) => boolean,
): readonly T[] {
  if (existing.length === 0 || replacements.length === 0) {
    return replacements;
  }

  const reused = new Set<number>();
  let changed = false;
  const normalized = replacements.map((replacement) => {
    const matchIndex = existing.findIndex((value, index) => (
      !reused.has(index) && isEquivalent(value, replacement)
    ));
    if (matchIndex === -1) {
      return replacement;
    }

    reused.add(matchIndex);
    changed = true;
    return existing[matchIndex];
  });

  return changed ? normalized : replacements;
}

function replaceFootnoteRanges<T extends RangeLike>(
  values: readonly T[],
  window: RangeLike,
  replacements: readonly T[],
  isEquivalent: (left: T, right: T) => boolean,
): readonly T[] {
  const targetWindow = replacementWindow(window, replacements);

  let start = values.length;
  for (let index = 0; index < values.length; index++) {
    if (
      rangesOverlap(values[index], targetWindow)
      || values[index].from >= targetWindow.from
    ) {
      start = index;
      break;
    }
  }

  if (start === values.length) {
    return replacements.length === 0 ? values : [...values, ...replacements];
  }

  let end = start;
  while (end < values.length && rangesOverlap(values[end], targetWindow)) {
    end++;
  }

  const nextReplacements = reuseEquivalentReplacements(
    values.slice(start, end),
    replacements,
    isEquivalent,
  );

  if (start === end && nextReplacements.length === 0) {
    return values;
  }

  if (
    end - start === nextReplacements.length
    && nextReplacements.every((value, index) => value === values[start + index])
  ) {
    return values;
  }

  return [
    ...values.slice(0, start),
    ...nextReplacements,
    ...values.slice(end),
  ];
}

function removeDirtyOldRanges<T extends RangeLike>(
  values: readonly T[],
  dirtyWindows: readonly Pick<DirtyWindow, "fromOld" | "toOld">[],
): readonly T[] {
  let next = values;
  for (const window of dirtyWindows) {
    next = replaceOverlappingRanges(
      next,
      { from: window.fromOld, to: window.toOld },
      [],
    );
  }
  return next;
}

export function createFootnoteSlice(
  refs: readonly FootnoteReference[],
  definitions: readonly FootnoteDefinition[],
  previous?: FootnoteSlice,
): FootnoteSlice {
  const plan = buildFootnotePlan(refs, definitions, {
    previous,
    previousDefinitions: previous?.definitions,
    refsUnchanged: refs === previous?.refs,
    sameDefinition: sameFootnoteDefinition,
  });

  return {
    refs: plan.refs,
    definitions: plan.definitions,
    defs: plan.defs,
    refByFrom: plan.refByFrom,
    defByFrom: plan.defByFrom,
    numberById: plan.numberById,
    orderedEntries: plan.orderedEntries,
  };
}

export function buildFootnoteSlice(
  structural: Pick<StructuralWindowExtraction, "footnoteRefs" | "footnoteDefs">,
): FootnoteSlice {
  return createFootnoteSlice(structural.footnoteRefs, structural.footnoteDefs);
}

export function mergeFootnoteSlice(
  previous: FootnoteSlice,
  delta: Pick<SemanticDelta, "mapOldToNew">,
  dirtyExtractions: readonly DirtyFootnoteWindowExtraction[],
): FootnoteSlice {
  const dirtyWindows = dirtyExtractions.map(({ window }) => window);
  let refs = mapFootnoteReferences(
    removeDirtyOldRanges(previous.refs, dirtyWindows),
    deltaMapper(delta),
  );
  let definitions = mapFootnoteDefinitions(
    removeDirtyOldRanges(previous.definitions, dirtyWindows),
    deltaMapper(delta),
  );

  for (const { window, structural } of dirtyExtractions) {
    refs = replaceFootnoteRanges(
      refs,
      { from: window.fromNew, to: window.toNew },
      structural.footnoteRefs,
      sameFootnoteReference,
    );
    definitions = replaceFootnoteRanges(
      definitions,
      { from: window.fromNew, to: window.toNew },
      structural.footnoteDefs,
      sameFootnoteDefinition,
    );
  }

  if (refs === previous.refs && definitions === previous.definitions) {
    return previous;
  }

  return createFootnoteSlice(refs, definitions, previous);
}
