import { trimSourceRange } from "./math-source";
import type { DocumentReferenceTarget } from "./reference-targets";

export interface ReferencePreviewLabelInput {
  readonly kind: string;
  readonly label?: string;
  readonly title?: string;
}

export interface ReferencePreviewRange {
  readonly from: number;
  readonly to: number;
}

export type ReferencePreviewEntry =
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly label: string;
      readonly title: string;
      readonly text: string;
      readonly level: number;
      readonly from: number;
      readonly to: number;
      readonly number?: string;
    }
  | {
      readonly kind: "equation";
      readonly id: string;
      readonly label: string;
      readonly latex: string;
      readonly text: string;
      readonly from: number;
      readonly to: number;
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly number: string;
      readonly ordinal: number;
    }
  | {
      readonly kind: "block";
      readonly id: string;
      readonly label: string;
      readonly blockType: string;
      readonly title?: string;
      readonly from: number;
      readonly to: number;
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly number?: string;
      readonly ordinal?: number;
    };

export type ReferencePreviewSourceKind = "equation" | "fenced-div" | "heading";

export interface ReferencePreviewSourceMatch {
  readonly kind: ReferencePreviewSourceKind;
  readonly source: string;
  readonly previewSource: string;
}

export type ReferencePreviewBodyPlan =
  | {
      readonly kind: "none";
      readonly key: "none";
    }
  | {
      readonly kind: "display-math";
      readonly latex: string;
      readonly markdownSource: string;
      readonly key: string;
    }
  | {
      readonly kind: "markdown";
      readonly markdownSource: string;
      readonly key: string;
    };

export interface ReferencePreviewContentPlan {
  readonly bodyPlan: ReferencePreviewBodyPlan;
  readonly headerText: string;
  readonly key: string;
  readonly suppressGeneratedSectionNumbers: boolean;
}

export type ReferencePreviewBodyInput =
  | {
      readonly kind: "heading";
    }
  | {
      readonly kind: "equation";
      readonly latex: string;
    }
  | {
      readonly kind: "block";
      readonly fullSource: string;
      readonly bodySource: string;
      readonly useFullSource: boolean;
    };

export interface HeadingReferencePreviewEntryInput {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly text?: string;
  readonly level: number;
  readonly sourceRange: ReferencePreviewRange;
  readonly number?: string;
}

export interface EquationReferencePreviewEntryInput {
  readonly id: string;
  readonly label: string;
  readonly latex: string;
  readonly sourceRange: ReferencePreviewRange;
  readonly bodyRange: ReferencePreviewRange;
  readonly number: number;
}

export interface BlockReferencePreviewEntryInput {
  readonly id: string;
  readonly label: string;
  readonly blockType: string;
  readonly sourceRange: ReferencePreviewRange;
  readonly bodyRange: ReferencePreviewRange;
  readonly title?: string;
  readonly number?: number;
}

export interface FencedDivBodyRangeInput {
  readonly blockRange: ReferencePreviewRange;
  readonly openFenceTo?: number;
  readonly closeFenceFrom?: number;
}

export interface FencedDivPreviewBodyInput {
  readonly fullRange: ReferencePreviewRange;
  readonly bodyRange?: ReferencePreviewRange | null;
  readonly openFenceTo?: number;
  readonly closeFenceFrom?: number;
  readonly useFullSource: boolean;
}

export function unresolvedReferencePreviewLabel(key: string): string {
  return `Unresolved: ${key}`;
}

export function referencePreviewHeaderText(
  entry: ReferencePreviewLabelInput,
  fallback: string,
): string {
  if (
    (entry.kind === "heading" || entry.kind === "block")
    && entry.title
    && entry.title !== entry.label
  ) {
    return `${entry.label ?? fallback} ${entry.title}`;
  }
  return entry.label || fallback;
}

export function referencePreviewBodyPlan(
  input: ReferencePreviewBodyInput,
): ReferencePreviewBodyPlan {
  if (input.kind === "heading") {
    return { kind: "none", key: "none" };
  }

  if (input.kind === "equation") {
    const latex = input.latex.trim();
    if (!latex) return { kind: "none", key: "none" };
    return {
      kind: "display-math",
      latex,
      markdownSource: `$$\n${latex}\n$$`,
      key: `display-math\0${latex}`,
    };
  }

  const markdownSource = (input.useFullSource ? input.fullSource : input.bodySource).trim();
  if (!markdownSource) return { kind: "none", key: "none" };
  return {
    kind: "markdown",
    markdownSource,
    key: `${input.useFullSource ? "full" : "body"}\0${markdownSource}`,
  };
}

export function referencePreviewContentPlan(input: {
  readonly target: ReferencePreviewLabelInput;
  readonly fallbackLabel: string;
  readonly bodyInput?: ReferencePreviewBodyInput;
  readonly suppressGeneratedSectionNumbers?: boolean;
}): ReferencePreviewContentPlan {
  const headerText = referencePreviewHeaderText(input.target, input.fallbackLabel);
  const bodyPlan: ReferencePreviewBodyPlan = input.bodyInput
    ? referencePreviewBodyPlan(input.bodyInput)
    : { kind: "none", key: "none" };
  return {
    bodyPlan,
    headerText,
    key: `${headerText}\0${bodyPlan.key}\0${input.suppressGeneratedSectionNumbers ? "no-section-numbers" : "section-numbers"}`,
    suppressGeneratedSectionNumbers: input.suppressGeneratedSectionNumbers ?? false,
  };
}

export function headingReferencePreviewEntry(
  input: HeadingReferencePreviewEntryInput,
): ReferencePreviewEntry {
  return {
    kind: "heading",
    id: input.id,
    label: input.label,
    title: input.title,
    text: input.text ?? input.title,
    level: input.level,
    from: input.sourceRange.from,
    to: input.sourceRange.to,
    ...(input.number ? { number: input.number } : {}),
  };
}

export function equationReferencePreviewEntry(
  input: EquationReferencePreviewEntryInput,
): ReferencePreviewEntry {
  return {
    kind: "equation",
    id: input.id,
    label: input.label,
    latex: input.latex,
    text: input.latex,
    from: input.sourceRange.from,
    to: input.sourceRange.to,
    bodyFrom: input.bodyRange.from,
    bodyTo: input.bodyRange.to,
    number: String(input.number),
    ordinal: input.number,
  };
}

export function blockReferencePreviewEntry(
  input: BlockReferencePreviewEntryInput,
): ReferencePreviewEntry {
  return {
    kind: "block",
    id: input.id,
    label: input.label,
    blockType: input.blockType,
    ...(input.title ? { title: input.title } : {}),
    from: input.sourceRange.from,
    to: input.sourceRange.to,
    bodyFrom: input.bodyRange.from,
    bodyTo: input.bodyRange.to,
    ...(input.number === undefined ? {} : {
      number: String(input.number),
      ordinal: input.number,
    }),
  };
}

export function trimReferencePreviewRange(
  source: string,
  range: ReferencePreviewRange,
): ReferencePreviewRange {
  return trimSourceRange(source, range.from, range.to);
}

function lineEndAfter(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  return newline < 0 ? source.length : newline;
}

export function fencedDivBodyRangeFromSource(
  source: string,
  input: FencedDivBodyRangeInput,
): ReferencePreviewRange {
  let contentFrom = input.blockRange.from;
  let contentTo = input.blockRange.to;

  if (input.openFenceTo !== undefined) {
    contentFrom = lineEndAfter(source, input.openFenceTo) + 1;
  }
  if (input.closeFenceFrom !== undefined && input.closeFenceFrom >= 0) {
    contentTo = input.closeFenceFrom;
  }

  contentFrom = Math.min(Math.max(contentFrom, 0), source.length);
  contentTo = Math.min(Math.max(contentTo, 0), source.length);
  if (contentFrom >= contentTo) {
    return { from: contentFrom, to: contentFrom };
  }
  return trimSourceRange(source, contentFrom, contentTo);
}

export function fencedDivPreviewBodyRange(
  source: string,
  input: Omit<FencedDivPreviewBodyInput, "useFullSource">,
): ReferencePreviewRange {
  if (input.bodyRange) {
    return trimReferencePreviewRange(source, input.bodyRange);
  }
  return fencedDivBodyRangeFromSource(source, {
    blockRange: input.fullRange,
    openFenceTo: input.openFenceTo,
    closeFenceFrom: input.closeFenceFrom,
  });
}

export function blockPreviewBodyInputFromSource(
  source: string,
  input: {
    readonly fullRange: ReferencePreviewRange;
    readonly bodyRange: ReferencePreviewRange;
    readonly useFullSource: boolean;
  },
): ReferencePreviewBodyInput {
  return {
    kind: "block",
    fullSource: source.slice(input.fullRange.from, input.fullRange.to),
    bodySource: source.slice(input.bodyRange.from, input.bodyRange.to),
    useFullSource: input.useFullSource,
  };
}

export function blockPreviewBodyInputFromFencedDiv(
  source: string,
  input: FencedDivPreviewBodyInput,
): ReferencePreviewBodyInput {
  return blockPreviewBodyInputFromSource(source, {
    fullRange: input.fullRange,
    bodyRange: fencedDivPreviewBodyRange(source, input),
    useFullSource: input.useFullSource,
  });
}

export function referencePreviewBodyInputFromEntry(
  entry: ReferencePreviewEntry,
  source?: string,
  options: {
    readonly useFullSource?: boolean;
  } = {},
): ReferencePreviewBodyInput {
  if (entry.kind === "heading") {
    return { kind: "heading" };
  }

  if (entry.kind === "equation") {
    return { kind: "equation", latex: entry.latex };
  }

  return blockPreviewBodyInputFromSource(source ?? "", {
    fullRange: { from: entry.from, to: entry.to },
    bodyRange: { from: entry.bodyFrom, to: entry.bodyTo },
    useFullSource: options.useFullSource ?? false,
  });
}

export function referencePreviewEntryFromTarget(
  target: DocumentReferenceTarget,
  input: {
    readonly bodyRange?: ReferencePreviewRange;
    readonly fallbackId: string;
    readonly headingLevel?: number;
    readonly sourceRange?: ReferencePreviewRange;
  },
): ReferencePreviewEntry | null {
  const id = target.id ?? input.fallbackId;
  const sourceRange = input.sourceRange ?? { from: target.from, to: target.to };

  if (target.kind === "heading") {
    return headingReferencePreviewEntry({
      id,
      label: target.displayLabel,
      title: target.title ?? target.text ?? "",
      text: target.text,
      level: input.headingLevel ?? 0,
      sourceRange,
      number: target.number,
    });
  }

  if (target.kind === "equation") {
    if (target.ordinal === undefined) return null;
    return equationReferencePreviewEntry({
      id,
      label: target.displayLabel,
      latex: target.text ?? "",
      sourceRange,
      bodyRange: input.bodyRange ?? sourceRange,
      number: target.ordinal,
    });
  }

  return blockReferencePreviewEntry({
    id,
    label: target.displayLabel,
    blockType: target.blockType ?? "",
    title: target.title,
    sourceRange,
    bodyRange: input.bodyRange ?? sourceRange,
    number: target.ordinal,
  });
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function findEquationPreviewSource(source: string, key: string): string | null {
  const escapedKey = escapeRegExpLiteral(key);
  const labelPattern = String.raw`\{\s*#${escapedKey}\s*\}`;
  const labelMatch = new RegExp(labelPattern).exec(source);
  if (!labelMatch) return null;

  const beforeLabel = source.slice(0, labelMatch.index);
  const beforeMath = beforeLabel.trimEnd();

  const closeDollars = beforeMath.lastIndexOf("$$");
  const closeBracket = beforeMath.lastIndexOf("\\]");
  if (closeDollars > closeBracket) {
    if (source.slice(closeDollars + 2, labelMatch.index).trim() !== "") return null;
    const openDollars = beforeMath.lastIndexOf("$$", closeDollars - 1);
    if (openDollars >= 0) {
      return beforeMath.slice(openDollars, closeDollars + 2);
    }
  }

  if (closeBracket >= 0) {
    if (source.slice(closeBracket + 2, labelMatch.index).trim() !== "") return null;
    const openBracket = beforeMath.lastIndexOf("\\[", closeBracket - 1);
    if (openBracket >= 0) {
      return beforeMath.slice(openBracket, closeBracket + 2);
    }
  }
  return null;
}

export function findHeadingPreviewSource(source: string, key: string): string | null {
  const escapedKey = escapeRegExpLiteral(key);
  const pattern = new RegExp(String.raw`^#{1,6}\s+.*\{[^}\n]*#${escapedKey}[^}\n]*\}\s*$`, "m");
  return pattern.exec(source)?.[0].trimEnd() ?? null;
}

export function findFencedDivPreviewSource(source: string, key: string): string | null {
  const lines = source.split(/\r?\n/);
  const idNeedle = `#${key}`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = /^(:{3,})\s+/.exec(line);
    if (!fence || !line.includes(idNeedle)) continue;

    const fenceMarker = fence[1];
    const blockLines = [line];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? "";
      blockLines.push(next);
      if (next.trim() === fenceMarker) {
        return blockLines.join("\n");
      }
    }
    return blockLines.join("\n");
  }
  return null;
}

export function stripBracedLabelId(source: string, key: string): string {
  const escapedKey = escapeRegExpLiteral(key);
  return source.replace(new RegExp(String.raw`\s*\{[^}\n]*#${escapedKey}[^}\n]*\}\s*$`), "");
}

export function fencedDivBodySource(source: string): string {
  const lines = source.split(/\r?\n/);
  if (lines.length < 2) return source;
  const openingFence = /^(:{3,})\s+/.exec(lines[0] ?? "");
  if (!openingFence) return source;
  let closingIndex = -1;
  for (let index = lines.length - 1; index > 0; index -= 1) {
    if ((lines[index] ?? "").trim() === openingFence[1]) {
      closingIndex = index;
      break;
    }
  }
  const bodyLines = lines.slice(1, closingIndex > 0 ? closingIndex : undefined);
  const body = bodyLines.join("\n").trim();
  return body || source;
}

export function findReferencePreviewSource(
  source: string,
  key: string,
): ReferencePreviewSourceMatch | null {
  const equationSource = findEquationPreviewSource(source, key);
  if (equationSource) {
    return {
      kind: "equation",
      source: equationSource,
      previewSource: stripBracedLabelId(equationSource, key),
    };
  }

  const fencedDivSource = findFencedDivPreviewSource(source, key);
  if (fencedDivSource) {
    return {
      kind: "fenced-div",
      source: fencedDivSource,
      previewSource: fencedDivBodySource(fencedDivSource),
    };
  }

  const headingSource = findHeadingPreviewSource(source, key);
  if (headingSource) {
    return {
      kind: "heading",
      source: headingSource,
      previewSource: stripBracedLabelId(headingSource, key),
    };
  }

  return null;
}

export function referencePreviewContentPlanFromEntry(
  entry: ReferencePreviewEntry,
  source: string | undefined,
  fallbackLabel: string,
  options: {
    readonly useFullSource?: boolean;
  } = {},
): ReferencePreviewContentPlan {
  return referencePreviewContentPlan({
    target: entry,
    fallbackLabel,
    bodyInput: referencePreviewBodyInputFromEntry(entry, source, options),
  });
}

export function referencePreviewContentPlanFromSource(
  source: string,
  key: string,
  fallbackLabel: string,
): ReferencePreviewContentPlan | null {
  const match = findReferencePreviewSource(source, key);
  if (!match) return null;

  return referencePreviewContentPlan({
    target: { kind: match.kind, label: fallbackLabel || key },
    fallbackLabel: key,
    bodyInput: {
      kind: "block",
      fullSource: match.previewSource,
      bodySource: match.previewSource,
      useFullSource: true,
    },
    suppressGeneratedSectionNumbers: match.kind === "heading",
  });
}
