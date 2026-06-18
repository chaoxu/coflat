export interface FootnoteOrderingItem {
  readonly id: string;
}

export interface FootnoteNumberingState {
  readonly numberById: ReadonlyMap<string, number>;
  readonly orderedIds: readonly string[];
}

export interface MutableFootnoteNumberingState {
  numberById: Map<string, number>;
  orderedIds: string[];
}

export function createFootnoteNumberingState(): MutableFootnoteNumberingState {
  return {
    numberById: new Map(),
    orderedIds: [],
  };
}

export function ensureFootnoteNumber(
  state: MutableFootnoteNumberingState,
  id: string,
): number {
  const existing = state.numberById.get(id);
  if (existing !== undefined) return existing;
  const number = state.orderedIds.length + 1;
  state.numberById.set(id, number);
  state.orderedIds.push(id);
  return number;
}

export function footnoteNumberingState(
  refs: readonly FootnoteOrderingItem[],
  definitions: Iterable<FootnoteOrderingItem>,
): FootnoteNumberingState {
  const state = createFootnoteNumberingState();
  for (const ref of refs) {
    ensureFootnoteNumber(state, ref.id);
  }
  for (const def of definitions) {
    ensureFootnoteNumber(state, def.id);
  }
  return state;
}

export function footnoteNumberById(
  refs: readonly FootnoteOrderingItem[],
  definitions: Iterable<FootnoteOrderingItem>,
): ReadonlyMap<string, number> {
  return footnoteNumberingState(refs, definitions).numberById;
}

