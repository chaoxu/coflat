export type HeadingNumberCounters = readonly number[];

export interface HeadingNumberInput {
  readonly level: number;
  readonly unnumbered: boolean;
}

export interface HeadingNumberResult {
  readonly counters: HeadingNumberCounters;
  readonly number: string;
}

export function initialHeadingNumberCounters(): HeadingNumberCounters {
  return [0, 0, 0, 0, 0, 0, 0];
}

export function nextHeadingNumber(
  heading: HeadingNumberInput,
  counters: HeadingNumberCounters,
): HeadingNumberResult {
  const nextCounters = [...counters];
  if (heading.unnumbered) {
    return { counters: nextCounters, number: "" };
  }

  nextCounters[heading.level] = (nextCounters[heading.level] ?? 0) + 1;
  for (let level = heading.level + 1; level <= 6; level++) {
    nextCounters[level] = 0;
  }

  return {
    counters: nextCounters,
    number: nextCounters.slice(1, heading.level + 1).join("."),
  };
}
