export interface HeadingNumberCounters {
  readonly appendix: boolean;
  readonly values: readonly number[];
}

export interface HeadingNumberInput {
  readonly appendixBoundary?: boolean;
  readonly level: number;
  readonly unnumbered: boolean;
}

export interface HeadingNumberResult {
  readonly counters: HeadingNumberCounters;
  readonly number: string;
}

export function initialHeadingNumberCounters(): HeadingNumberCounters {
  return { appendix: false, values: [0, 0, 0, 0, 0, 0, 0] };
}

export function nextHeadingNumber(
  heading: HeadingNumberInput,
  counters: HeadingNumberCounters,
): HeadingNumberResult {
  if (heading.appendixBoundary) {
    return {
      counters: { appendix: true, values: [0, 0, 0, 0, 0, 0, 0] },
      number: "",
    };
  }

  const nextValues = [...counters.values];
  if (heading.unnumbered) {
    return { counters: { appendix: counters.appendix, values: nextValues }, number: "" };
  }

  if (counters.appendix && heading.level > 1 && (nextValues[1] ?? 0) === 0) {
    nextValues[1] = 1;
  }
  nextValues[heading.level] = (nextValues[heading.level] ?? 0) + 1;
  for (let level = heading.level + 1; level <= 6; level++) {
    nextValues[level] = 0;
  }

  return {
    counters: { appendix: counters.appendix, values: nextValues },
    number: formatHeadingNumber(nextValues, heading.level, counters.appendix),
  };
}

function formatHeadingNumber(
  values: readonly number[],
  level: number,
  appendix: boolean,
): string {
  if (!appendix) return values.slice(1, level + 1).join(".");
  const first = values[1] ?? 0;
  const appendixPrefix = first > 0 ? alphaCounter(first) : "0";
  if (level === 1) return appendixPrefix;
  return [appendixPrefix, ...values.slice(2, level + 1)].join(".");
}

function alphaCounter(value: number): string {
  let remaining = value;
  let out = "";
  while (remaining > 0) {
    remaining -= 1;
    out = String.fromCharCode(65 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
}
