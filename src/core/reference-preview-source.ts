export interface ReferencePreviewLabelInput {
  readonly kind: string;
  readonly label?: string;
  readonly title?: string;
}

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
