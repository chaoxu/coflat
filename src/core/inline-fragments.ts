import type { SyntaxNode } from "@lezer/common";
import { parseMarkdownSource } from "./parser";
import { MARK_NODES } from "./parser/inline-mark-nodes";
import {
  BRACKETED_REFERENCE_EXACT_RE,
  extractReferenceCluster,
  NARRATIVE_REFERENCE_GLOBAL_RE,
} from "./lib/reference-grammar";

export type InlineFragment =
  | ({ kind: "text"; text: string } & InlineFragmentMeta)
  | ({ kind: "emphasis"; children: readonly InlineFragment[] } & InlineFragmentMeta)
  | ({ kind: "strong"; children: readonly InlineFragment[] } & InlineFragmentMeta)
  | ({ kind: "strikethrough"; children: readonly InlineFragment[] } & InlineFragmentMeta)
  | ({ kind: "highlight"; children: readonly InlineFragment[] } & InlineFragmentMeta)
  | ({ kind: "code"; text: string } & InlineFragmentMeta)
  | ({ kind: "math"; latex: string; raw: string } & InlineFragmentMeta)
  | ({ kind: "link"; href?: string; children: readonly InlineFragment[] } & InlineFragmentMeta)
  | ({
      kind: "reference";
      parenthetical: boolean;
      rawText: string;
      ids: readonly string[];
      locators: readonly (string | undefined)[];
    } & InlineFragmentMeta)
  | ({
      kind: "image";
      rawAlt: string;
      alt: readonly InlineFragment[];
      src?: string;
    } & InlineFragmentMeta)
  | ({ kind: "footnote-ref"; id: string } & InlineFragmentMeta)
  | ({ kind: "hard-break" } & InlineFragmentMeta);

export interface InlineSourceRange {
  readonly from: number;
  readonly to: number;
}

export interface InlineFragmentMeta {
  readonly sourceRange?: InlineSourceRange;
}

export interface InlineFragmentBuildOptions {
  readonly sourceRanges?: boolean;
}

function sourceRange(
  from: number,
  to: number,
  options: InlineFragmentBuildOptions,
): InlineFragmentMeta {
  return options.sourceRanges ? { sourceRange: { from, to } } : {};
}

function createTextFragment(
  text: string,
  from: number,
  to: number,
  options: InlineFragmentBuildOptions,
): InlineFragment | null {
  return text ? { kind: "text", text, ...sourceRange(from, to, options) } : null;
}

function getCodeText(node: SyntaxNode, doc: string): string {
  const marks = node.getChildren("CodeMark");
  if (marks.length >= 2) {
    return doc.slice(marks[0].to, marks[marks.length - 1].from);
  }
  return doc.slice(node.from, node.to);
}

function getInlineMath(node: SyntaxNode, doc: string): { latex: string; raw: string } {
  const raw = doc.slice(node.from, node.to);
  const marks = node.getChildren("InlineMathMark");
  if (marks.length >= 2) {
    return {
      latex: doc.slice(marks[0].to, marks[marks.length - 1].from),
      raw,
    };
  }
  return { latex: raw, raw };
}

function getDelimitedRange(
  node: SyntaxNode,
  markName: string,
): { from: number; to: number } | null {
  const marks = node.getChildren(markName);
  if (marks.length < 2) return null;
  const from = marks[0].to;
  const to = marks[1].from;
  return to >= from ? { from, to } : null;
}

function buildLinkChildren(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): readonly InlineFragment[] {
  const range = getDelimitedRange(node, "LinkMark");
  if (!range) {
    return [createTextFragment(doc.slice(node.from, node.to), node.from, node.to, options)]
      .filter(Boolean) as InlineFragment[];
  }
  return buildInlineFragmentsRaw(node, doc, options, range.from, range.to);
}

function buildLinkFragment(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): InlineFragment[] {
  const raw = doc.slice(node.from, node.to);
  const referenceMatch = BRACKETED_REFERENCE_EXACT_RE.exec(raw);
  if (referenceMatch) {
    const referenceBody = referenceMatch[1] ?? "";
    const referenceParts = extractReferenceCluster(referenceBody);
    return [{
      kind: "reference",
      parenthetical: true,
      rawText: referenceBody,
      ids: referenceParts.ids,
      locators: referenceParts.locators,
      ...sourceRange(node.from, node.to, options),
    }];
  }

  const hrefNode = node.getChild("URL");
  if (!hrefNode) {
    const text = createTextFragment(raw, node.from, node.to, options);
    return text ? [text] : [];
  }
  return [{
    kind: "link",
    href: doc.slice(hrefNode.from, hrefNode.to).trim(),
    children: buildLinkChildren(node, doc, options),
    ...sourceRange(node.from, node.to, options),
  }];
}

function buildImageFragment(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): InlineFragment {
  const range = getDelimitedRange(node, "LinkMark");
  const rawAlt = range ? doc.slice(range.from, range.to) : "";
  const alt = range ? buildInlineFragmentsRaw(node, doc, options, range.from, range.to) : [];
  const srcNode = node.getChild("URL");
  const src = srcNode ? doc.slice(srcNode.from, srcNode.to).trim() : undefined;
  return {
    kind: "image",
    rawAlt,
    alt,
    src,
    ...sourceRange(node.from, node.to, options),
  };
}

function buildAutolinkFragment(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): InlineFragment[] {
  const urlNode = node.getChild("URL");
  if (!urlNode) {
    const text = createTextFragment(doc.slice(node.from, node.to), node.from, node.to, options);
    return text ? [text] : [];
  }
  const href = doc.slice(urlNode.from, urlNode.to);
  return [{
    kind: "link",
    href,
    children: [{ kind: "text", text: href, ...sourceRange(urlNode.from, urlNode.to, options) }],
    ...sourceRange(node.from, node.to, options),
  }];
}

function buildFootnoteFragment(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): InlineFragment {
  const raw = doc.slice(node.from, node.to);
  const match = /^\[\^([^\]]+)\]$/.exec(raw);
  return {
    kind: "footnote-ref",
    id: match?.[1] ?? raw,
    ...sourceRange(node.from, node.to, options),
  };
}

function buildInlineFragment(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
): InlineFragment[] {
  if (MARK_NODES.has(node.name)) {
    return [];
  }

  switch (node.name) {
    case "Emphasis":
      return [{
        kind: "emphasis",
        children: buildInlineFragmentsRaw(node, doc, options),
        ...sourceRange(node.from, node.to, options),
      }];
    case "StrongEmphasis":
      return [{
        kind: "strong",
        children: buildInlineFragmentsRaw(node, doc, options),
        ...sourceRange(node.from, node.to, options),
      }];
    case "Strikethrough":
      return [{
        kind: "strikethrough",
        children: buildInlineFragmentsRaw(node, doc, options),
        ...sourceRange(node.from, node.to, options),
      }];
    case "Highlight":
      return [{
        kind: "highlight",
        children: buildInlineFragmentsRaw(node, doc, options),
        ...sourceRange(node.from, node.to, options),
      }];
    case "InlineCode":
      return [{ kind: "code", text: getCodeText(node, doc), ...sourceRange(node.from, node.to, options) }];
    case "InlineMath": {
      const { latex, raw } = getInlineMath(node, doc);
      return [{ kind: "math", latex, raw, ...sourceRange(node.from, node.to, options) }];
    }
    case "Link":
      return buildLinkFragment(node, doc, options);
    case "Autolink":
      return buildAutolinkFragment(node, doc, options);
    case "URL": {
      if (node.parent?.name !== "Autolink") {
        const text = createTextFragment(doc.slice(node.from, node.to), node.from, node.to, options);
        return text ? [text] : [];
      }
      const href = doc.slice(node.from, node.to);
      return [{
        kind: "link",
        href,
        children: [{ kind: "text", text: href, ...sourceRange(node.from, node.to, options) }],
        ...sourceRange(node.from, node.to, options),
      }];
    }
    case "Image":
      return [buildImageFragment(node, doc, options)];
    case "FootnoteRef":
      return [buildFootnoteFragment(node, doc, options)];
    case "Escape": {
      const text = createTextFragment(doc.slice(node.from + 1, node.to), node.from, node.to, options);
      return text ? [text] : [];
    }
    case "HardBreak":
      return [{ kind: "hard-break", ...sourceRange(node.from, node.to, options) }];
    default: {
      const text = createTextFragment(doc.slice(node.from, node.to), node.from, node.to, options);
      return text ? [text] : [];
    }
  }
}

function splitNarrativeReferenceText(fragment: Extract<InlineFragment, { kind: "text" }>): InlineFragment[] {
  const { text } = fragment;
  if (!text) return [];

  const fragments: InlineFragment[] = [];
  let pos = 0;

  NARRATIVE_REFERENCE_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NARRATIVE_REFERENCE_GLOBAL_RE.exec(text)) !== null) {
    const from = match.index;
    const to = from + match[0].length;
    if (from > pos) {
      fragments.push({
        kind: "text",
        text: text.slice(pos, from),
        ...(fragment.sourceRange
          ? { sourceRange: { from: fragment.sourceRange.from + pos, to: fragment.sourceRange.from + from } }
          : {}),
      });
    }
    fragments.push({
      kind: "reference",
      parenthetical: false,
      rawText: match[0],
      ids: [match[1]],
      locators: [undefined],
      ...(fragment.sourceRange
        ? { sourceRange: { from: fragment.sourceRange.from + from, to: fragment.sourceRange.from + to } }
        : {}),
    });
    pos = to;
  }

  if (pos < text.length) {
    fragments.push({
      kind: "text",
      text: text.slice(pos),
      ...(fragment.sourceRange
        ? { sourceRange: { from: fragment.sourceRange.from + pos, to: fragment.sourceRange.to } }
        : {}),
    });
  }

  return fragments.length > 0 ? fragments : [fragment];
}

function normalizeNarrativeReferences(
  fragments: readonly InlineFragment[],
): InlineFragment[] {
  const normalized: InlineFragment[] = [];

  for (const fragment of fragments) {
    switch (fragment.kind) {
      case "text":
        normalized.push(...splitNarrativeReferenceText(fragment));
        break;

      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
        normalized.push({
          ...fragment,
          children: normalizeNarrativeReferences(fragment.children),
        });
        break;

      default:
        normalized.push(fragment);
        break;
    }
  }

  return normalized;
}

function buildInlineFragmentsRaw(
  node: SyntaxNode,
  doc: string,
  options: InlineFragmentBuildOptions,
  rangeFrom?: number,
  rangeTo?: number,
): InlineFragment[] {
  const from = rangeFrom ?? node.from;
  const to = rangeTo ?? node.to;
  const fragments: InlineFragment[] = [];
  let pos = from;
  let child = node.firstChild;

  while (child) {
    if (child.to > from && child.from < to) {
      if (child.from > pos) {
        const text = createTextFragment(doc.slice(pos, child.from), pos, child.from, options);
        if (text) fragments.push(text);
      }
      fragments.push(...buildInlineFragment(child, doc, options));
      pos = child.to;
    }
    child = child.nextSibling;
  }

  if (pos < to) {
    const text = createTextFragment(doc.slice(pos, to), pos, to, options);
    if (text) fragments.push(text);
  }

  return fragments;
}

function mergeAdjacentTextFragments(
  fragments: readonly InlineFragment[],
): InlineFragment[] {
  const merged: InlineFragment[] = [];
  for (const fragment of fragments) {
    const previous = merged.at(-1);
    if (previous?.kind === "text" && fragment.kind === "text") {
      merged[merged.length - 1] = {
        kind: "text",
        text: previous.text + fragment.text,
        ...(previous.sourceRange && fragment.sourceRange
          ? { sourceRange: { from: previous.sourceRange.from, to: fragment.sourceRange.to } }
          : {}),
      };
      continue;
    }
    merged.push(fragment);
  }
  return merged;
}

export function buildInlineFragments(
  node: SyntaxNode,
  doc: string,
  rangeFrom?: number,
  rangeTo?: number,
  options: InlineFragmentBuildOptions = {},
): InlineFragment[] {
  return normalizeNarrativeReferences(
    mergeAdjacentTextFragments(buildInlineFragmentsRaw(
      node,
      doc,
      options,
      rangeFrom,
      rangeTo,
    )),
  );
}

export function parseInlineFragments(
  text: string,
  options: InlineFragmentBuildOptions = {},
): InlineFragment[] {
  if (!text) return [];

  const tree = parseMarkdownSource(text, "semantic");
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) {
    return normalizeNarrativeReferences([{
      kind: "text",
      text,
      ...sourceRange(0, text.length, options),
    }]);
  }

  const fragments: InlineFragment[] = [];
  if (para.from > 0) {
    fragments.push({ kind: "text", text: text.slice(0, para.from), ...sourceRange(0, para.from, options) });
  }
  fragments.push(...buildInlineFragmentsRaw(para, text, options));
  if (para.to < text.length) {
    fragments.push({ kind: "text", text: text.slice(para.to), ...sourceRange(para.to, text.length, options) });
  }
  return normalizeNarrativeReferences(mergeAdjacentTextFragments(fragments));
}

export function inlineFragmentsPlainText(fragments: readonly InlineFragment[]): string {
  let out = "";
  for (const fragment of fragments) {
    switch (fragment.kind) {
      case "text":
      case "code":
        out += fragment.text;
        break;
      case "math":
        out += fragment.raw;
        break;
      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
        out += inlineFragmentsPlainText(fragment.children);
        break;
      case "link":
        out += inlineFragmentsPlainText(fragment.children);
        break;
      case "reference":
        out += fragment.parenthetical ? `[${fragment.rawText}]` : fragment.rawText;
        break;
      case "image":
        out += fragment.rawAlt;
        break;
      case "footnote-ref":
        out += fragment.id;
        break;
      case "hard-break":
        out += " ";
        break;
    }
  }
  return out;
}

function findNeutralGapAnchor(
  docText: string,
  from: number,
  to: number,
): number | null {
  if (to - from < 2) return null;

  for (let pos = from + 1; pos < to; pos++) {
    if (!/\s/.test(docText[pos] ?? "")) {
      return pos;
    }
  }

  return from + 1 < to ? from + 1 : null;
}

export function findInlineNeutralAnchor(text: string): number | null {
  if (!text) return null;

  const tree = parseMarkdownSource(text, "semantic");
  const doc = tree.topNode;
  const para = doc.firstChild;
  if (!para) return null;

  let pos = para.from;
  let child = para.firstChild;

  while (child) {
    if (child.from > pos) {
      const anchor = findNeutralGapAnchor(text, pos, child.from);
      if (anchor !== null) return anchor;
    }
    pos = child.to;
    child = child.nextSibling;
  }

  if (pos < para.to) {
    return findNeutralGapAnchor(text, pos, para.to);
  }

  return null;
}
