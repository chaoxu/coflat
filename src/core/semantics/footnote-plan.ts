import { footnoteNumberingState } from "../footnote-ordering";

export interface FootnotePlanReference {
  readonly id: string;
  readonly from: number;
}

export interface FootnotePlanDefinition {
  readonly id: string;
  readonly from: number;
}

export interface FootnotePlanOrderedEntry<TDefinition extends FootnotePlanDefinition> {
  readonly id: string;
  readonly number: number;
  readonly def: TDefinition;
}

export interface FootnotePlanSectionEntry<TDefinition extends FootnotePlanDefinition> {
  readonly id: string;
  readonly number: number;
  readonly def: TDefinition;
  readonly defFrom: number;
  readonly include: boolean;
}

export interface FootnotePlan<
  TReference extends FootnotePlanReference,
  TDefinition extends FootnotePlanDefinition,
> {
  readonly refs: readonly TReference[];
  readonly definitions: readonly TDefinition[];
  readonly defs: ReadonlyMap<string, TDefinition>;
  readonly refByFrom: ReadonlyMap<number, TReference>;
  readonly defByFrom: ReadonlyMap<number, TDefinition>;
  readonly numberById: ReadonlyMap<string, number>;
  readonly orderedIds: readonly string[];
  readonly orderedEntries: readonly FootnotePlanOrderedEntry<TDefinition>[];
}

export interface BuildFootnotePlanOptions<TDefinition extends FootnotePlanDefinition> {
  readonly previous?: Pick<FootnotePlan<FootnotePlanReference, TDefinition>, "numberById" | "orderedEntries">;
  readonly previousDefinitions?: readonly TDefinition[];
  readonly refsUnchanged?: boolean;
  readonly sameDefinition?: (left: TDefinition, right: TDefinition) => boolean;
}

function sameNumberMap(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  return left.size === right.size &&
    Array.from(left.entries()).every(([id, number]) => right.get(id) === number);
}

function buildNumberById<TDefinition extends FootnotePlanDefinition>(
  refs: readonly FootnotePlanReference[],
  definitions: readonly TDefinition[],
  previous: BuildFootnotePlanOptions<TDefinition>["previous"],
  previousDefinitions: readonly TDefinition[] | undefined,
  refsUnchanged: boolean | undefined,
  sameDefinition: ((left: TDefinition, right: TDefinition) => boolean) | undefined,
): ReadonlyMap<string, number> {
  if (
    previous &&
    refsUnchanged &&
    sameDefinition &&
    previousDefinitions &&
    definitions.length === previousDefinitions.length &&
    definitions.every((def, index) => {
      const previousDef = previousDefinitions[index];
      return previousDef !== undefined && sameDefinition(def, previousDef);
    })
  ) {
    return previous.numberById;
  }

  const numbers = footnoteNumberingState(refs, definitions).numberById;
  if (previous && sameNumberMap(numbers, previous.numberById)) {
    return previous.numberById;
  }
  return numbers;
}

function buildOrderedEntries<TDefinition extends FootnotePlanDefinition>(
  refs: readonly FootnotePlanReference[],
  definitions: readonly TDefinition[],
  defs: ReadonlyMap<string, TDefinition>,
  numberById: ReadonlyMap<string, number>,
  previous?: Pick<FootnotePlan<FootnotePlanReference, TDefinition>, "orderedEntries">,
): readonly FootnotePlanOrderedEntry<TDefinition>[] {
  const previousEntries = previous
    ? new Map(previous.orderedEntries.map((entry) => [entry.id, entry]))
    : null;
  const entries: FootnotePlanOrderedEntry<TDefinition>[] = [];

  for (const id of footnoteNumberingState(refs, definitions).orderedIds) {
    const def = defs.get(id);
    if (!def) continue;

    const number = numberById.get(id) ?? 0;
    const previousEntry = previousEntries?.get(id);
    if (
      previousEntry &&
      previousEntry.number === number &&
      previousEntry.def === def
    ) {
      entries.push(previousEntry);
      continue;
    }

    entries.push({ id, number, def });
  }

  if (
    previous &&
    entries.length === previous.orderedEntries.length &&
    entries.every((entry, index) => entry === previous.orderedEntries[index])
  ) {
    return previous.orderedEntries;
  }

  return entries;
}

export function buildFootnotePlan<
  TReference extends FootnotePlanReference,
  TDefinition extends FootnotePlanDefinition,
>(
  refs: readonly TReference[],
  definitions: readonly TDefinition[],
  options: BuildFootnotePlanOptions<TDefinition> = {},
): FootnotePlan<TReference, TDefinition> {
  const defs = new Map<string, TDefinition>();
  const refByFrom = new Map<number, TReference>();
  const defByFrom = new Map<number, TDefinition>();

  for (const ref of refs) {
    refByFrom.set(ref.from, ref);
  }

  for (const def of definitions) {
    defs.set(def.id, def);
    defByFrom.set(def.from, def);
  }

  const numbering = footnoteNumberingState(refs, definitions);
  const numberById = buildNumberById(
    refs,
    definitions,
    options.previous,
    options.previousDefinitions,
    options.refsUnchanged,
    options.sameDefinition,
  );
  const orderedEntries = buildOrderedEntries(
    refs,
    definitions,
    defs,
    numberById,
    options.previous,
  );

  return {
    refs,
    definitions,
    defs,
    refByFrom,
    defByFrom,
    numberById,
    orderedIds: numbering.orderedIds,
    orderedEntries,
  };
}

export function footnotePlanSectionEntries<
  TDefinition extends FootnotePlanDefinition,
>(
  orderedEntries: readonly FootnotePlanOrderedEntry<TDefinition>[],
  include: (entry: FootnotePlanOrderedEntry<TDefinition>) => boolean = () => true,
): readonly FootnotePlanSectionEntry<TDefinition>[] {
  return orderedEntries.map((entry) => ({
    id: entry.id,
    number: entry.number,
    def: entry.def,
    defFrom: entry.def.from,
    include: include(entry),
  }));
}
