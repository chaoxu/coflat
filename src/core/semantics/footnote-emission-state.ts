import {
  createFootnoteNumberingState,
  ensureFootnoteNumber,
  type MutableFootnoteNumberingState,
} from "../footnote-ordering";

export interface FootnoteEmissionEntry<TBody> {
  readonly id: string;
  readonly number: number;
  readonly body?: TBody;
  readonly hasRef: boolean;
}

export interface MutableFootnoteEmissionState<TBody> {
  readonly entriesById: Map<string, FootnoteEmissionEntry<TBody>>;
  readonly numbering: MutableFootnoteNumberingState;
}

export interface FootnoteEmissionSectionEntry<TBody> {
  readonly id: string;
  readonly number: number;
  readonly body?: TBody;
  readonly include: boolean;
}

export function createFootnoteEmissionState<TBody>(): MutableFootnoteEmissionState<TBody> {
  return {
    entriesById: new Map(),
    numbering: createFootnoteNumberingState(),
  };
}

export function snapshotFootnoteEmissionState<TBody>(
  state: MutableFootnoteEmissionState<TBody>,
): MutableFootnoteEmissionState<TBody> {
  return {
    entriesById: new Map(state.entriesById),
    numbering: {
      numberById: new Map(state.numbering.numberById),
      orderedIds: [...state.numbering.orderedIds],
    },
  };
}

export function registerFootnoteReference<TBody>(
  state: MutableFootnoteEmissionState<TBody>,
  id: string,
): FootnoteEmissionEntry<TBody> {
  const number = ensureFootnoteNumber(state.numbering, id);
  const previous = state.entriesById.get(id);
  const entry: FootnoteEmissionEntry<TBody> = {
    id,
    number,
    ...(previous?.body !== undefined ? { body: previous.body } : {}),
    hasRef: true,
  };
  state.entriesById.set(id, entry);
  return entry;
}

export function registerFootnoteDefinition<TBody>(
  state: MutableFootnoteEmissionState<TBody>,
  id: string,
  body: TBody,
): FootnoteEmissionEntry<TBody> {
  const number = ensureFootnoteNumber(state.numbering, id);
  const previous = state.entriesById.get(id);
  const entry: FootnoteEmissionEntry<TBody> = {
    id,
    number,
    body,
    hasRef: previous?.hasRef ?? false,
  };
  state.entriesById.set(id, entry);
  return entry;
}

export function footnoteEmissionSectionEntries<TBody>(
  state: MutableFootnoteEmissionState<TBody>,
  include: (entry: FootnoteEmissionEntry<TBody>) => boolean = () => true,
): readonly FootnoteEmissionSectionEntry<TBody>[] {
  return state.numbering.orderedIds.map((id) => {
    const entry = state.entriesById.get(id);
    return {
      id,
      number: state.numbering.numberById.get(id) ?? 0,
      ...(entry?.body !== undefined ? { body: entry.body } : {}),
      include: entry ? include(entry) : false,
    };
  });
}
