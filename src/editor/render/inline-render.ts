/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Parsing and fragment building now live in `src/core/inline-fragments.ts`.
 * This file is intentionally only the DOM render adapter.
 */

import type { SyntaxNode } from "@lezer/common";
import { CSS } from "../../core/constants/css-classes";
import type { LinkResolver } from "../../core/document-context-types";
import { createReaderFootnoteReferenceElement } from "../../core/footnote-reference-surface";
import { createInlineMarkElement } from "../../core/inline-mark-surface";
import {
  type InlineSurfacePolicy,
  inlineSurfacePolicy,
} from "../../core/inline-surface-policy";
import { isSafeUrl } from "../../core/lib/url-utils";
import { applyLinkSurface } from "../../core/link-surface";
import {
  createInlineMathSurfaceElement,
  renderInlineMathErrorFallback,
} from "../../core/math-inline-surface";
import {
  createImageSurfaceElement,
  createPdfSurfaceElement,
  isUnresolvedLocalMediaUrl,
  mediaKindForSrc,
  renderMediaLoadingInto,
} from "../../core/media-surface";
import {
  appendReferenceRouteSurfaceDom,
  referencePresentationRouteSurfacePlan,
} from "../../core/reference-surface";
import {
  applySourceRangeAttrs,
  type SourceRange,
} from "../../core/source-range-surface";
import {
  buildInlineFragments,
  type InlineFragment,
  inlineFragmentsPlainText,
  parseInlineFragments,
} from "../inline-fragments";
import type { InlineRenderSurface } from "../inline-surface";
import { resolveMarkdownReferencePathFromDocument } from "../lib/markdown-reference-paths";
import {
  planReferencePresentation,
  type ReferencePresentationContext,
} from "../references/presentation";
import { renderKatexToHtml } from "./inline-shared";

interface InlineSegment {
  isMath: boolean;
  content: string;
}

type DomInlineSurface = InlineRenderSurface | "document-body";

export interface InlineReferenceRenderContext extends ReferencePresentationContext {
  readonly linkResolver?: LinkResolver;
  readonly documentPath?: string;
  readonly imageUrlOverrides?: ReadonlyMap<string, string>;
  readonly footnoteNumbers?: ReadonlyMap<string, number>;
  readonly surface?: string;
}

export interface InlineDomRenderOptions {
  readonly sourcePositions?: boolean;
  readonly sourceOffset?: number;
}

function offsetSourceRange(
  fragment: InlineFragment,
  options: InlineDomRenderOptions,
): SourceRange | null {
  if (!options.sourcePositions || !fragment.sourceRange) return null;
  const offset = options.sourceOffset ?? 0;
  return {
    from: fragment.sourceRange.from + offset,
    to: fragment.sourceRange.to + offset,
  };
}

function applyFragmentSourceAttrs(
  element: HTMLElement,
  fragment: InlineFragment,
  options: InlineDomRenderOptions,
  atomic = false,
): void {
  const sourceRange = offsetSourceRange(fragment, options);
  if (!sourceRange) return;
  applySourceRangeAttrs(element, { sourceRange, sourceAtomic: atomic });
}

function appendSourceText(
  container: HTMLElement | DocumentFragment,
  text: string,
  fragment: InlineFragment,
  options: InlineDomRenderOptions,
  atomic = false,
): void {
  const sourceRange = offsetSourceRange(fragment, options);
  if (!sourceRange) {
    container.appendChild(document.createTextNode(text));
    return;
  }

  const span = document.createElement("span");
  span.className = CSS.text;
  applySourceRangeAttrs(span, { sourceRange, sourceAtomic: atomic });
  span.textContent = text;
  container.appendChild(span);
}

function renderFragments(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
  options: InlineDomRenderOptions = {},
): void {
  const policy = inlineSurfacePolicy(surface);
  for (const fragment of fragments) {
    renderFragment(container, fragment, macros, surface, policy, referenceContext, options);
  }
}

function renderReference(
  container: HTMLElement | DocumentFragment,
  fragment: Extract<InlineFragment, { kind: "reference" }>,
  policy: InlineSurfacePolicy,
  referenceContext?: InlineReferenceRenderContext,
  options: InlineDomRenderOptions = {},
): void {
  if (policy.references === "inert") {
    appendSourceText(container, fragment.rawText, fragment, options, true);
    return;
  }

  if (!referenceContext) {
    if (!fragment.parenthetical) {
      appendSourceText(container, fragment.rawText, fragment, options, true);
      return;
    }

    if (fragment.ids.length === 1) {
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${fragment.ids[0]}`;
      anchor.textContent = fragment.ids[0];
      applyFragmentSourceAttrs(anchor, fragment, options, true);
      if (fragment.parenthetical) {
        const span = document.createElement("span");
        span.className = CSS.crossref;
        applyFragmentSourceAttrs(span, fragment, options, true);
        span.appendChild(anchor);
        container.appendChild(span);
      } else {
        container.appendChild(anchor);
      }
      return;
    }

    const span = document.createElement("span");
    span.className = CSS.crossref;
    applyFragmentSourceAttrs(span, fragment, options, true);
    span.appendChild(document.createTextNode("("));
    fragment.ids.forEach((id, index) => {
      if (index > 0) span.appendChild(document.createTextNode("; "));
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${id}`;
      anchor.textContent = id;
      span.appendChild(anchor);
    });
    span.appendChild(document.createTextNode(")"));
    container.appendChild(span);
    return;
  }

  const raw = fragment.parenthetical
    ? `[${fragment.rawText}]`
    : fragment.rawText;
  const route = planReferencePresentation(referenceContext, {
    bracketed: fragment.parenthetical,
    ids: fragment.ids,
    locators: fragment.locators,
    raw,
  });

  if (!route) {
    appendSourceText(container, raw, fragment, options, true);
    return;
  }

  const plan = referencePresentationRouteSurfacePlan({
      bracketed: fragment.parenthetical,
      ids: fragment.ids,
      locators: fragment.locators,
      raw,
    }, route, {
      sourceAtomic: true,
      sourceRange: offsetSourceRange(fragment, options) ?? undefined,
    });
  if (plan.kind === "text") {
    appendSourceText(container, plan.text, fragment, options, true);
    return;
  }
  appendReferenceRouteSurfaceDom(container, plan);
}

function renderFragment(
  container: HTMLElement | DocumentFragment,
  fragment: InlineFragment,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  policy: InlineSurfacePolicy,
  referenceContext?: InlineReferenceRenderContext,
  options: InlineDomRenderOptions = {},
): void {
  switch (fragment.kind) {
    case "text":
      appendSourceText(container, fragment.text, fragment, options);
      return;

    case "emphasis": {
      const em = createInlineMarkElement(document, "emphasis", { surface });
      applyFragmentSourceAttrs(em, fragment, options);
      renderFragments(em, fragment.children, macros, surface, referenceContext, options);
      container.appendChild(em);
      return;
    }

    case "strong": {
      const strong = createInlineMarkElement(document, "strong", { surface });
      applyFragmentSourceAttrs(strong, fragment, options);
      renderFragments(strong, fragment.children, macros, surface, referenceContext, options);
      container.appendChild(strong);
      return;
    }

    case "strikethrough": {
      const del = createInlineMarkElement(document, "strikethrough", { surface });
      applyFragmentSourceAttrs(del, fragment, options);
      renderFragments(del, fragment.children, macros, surface, referenceContext, options);
      container.appendChild(del);
      return;
    }

    case "highlight": {
      const highlight = createInlineMarkElement(document, "highlight", { surface });
      applyFragmentSourceAttrs(highlight, fragment, options);
      renderFragments(highlight, fragment.children, macros, surface, referenceContext, options);
      container.appendChild(highlight);
      return;
    }

    case "code": {
      const code = createInlineMarkElement(document, "code", { surface });
      applyFragmentSourceAttrs(code, fragment, options, true);
      code.textContent = fragment.text;
      container.appendChild(code);
      return;
    }

    case "math": {
      const span = createInlineMathSurfaceElement(document, fragment.latex);
      applyFragmentSourceAttrs(span, fragment, options, true);
      const renderRawError = (label: string): void => {
        renderInlineMathErrorFallback(span, fragment.raw, label);
      };
      try {
        // "html" output (no .katex-mathml branch) is intentional here:
        // the rich-mode inline render path is on the typing hot path and
        // emitting MathML doubled the per-keystroke render cost on dense
        // documents (see 8121177d). Accessibility is preserved via the
        // role + aria-label above. Display math still uses the default
        // "htmlAndMathml" output (math-render.ts) so copy-as-MathML works
        // there; only inline CM6 trades the semantic branch for latency.
        const html = renderKatexToHtml(fragment.latex, false, macros, "html", false);
        if (html.includes("katex-error")) {
          renderRawError("KaTeX error");
        } else {
          span.innerHTML = html;
        }
      } catch (error: unknown) {
        renderRawError(
          error instanceof Error ? `KaTeX error: ${error.message}` : "KaTeX error",
        );
      }
      container.appendChild(span);
      return;
    }

    case "link": {
      if (policy.links === "inert") {
        renderFragments(container, fragment.children, macros, surface, referenceContext, options);
        return;
      }

      const href = fragment.href?.trim();
      if (!href || !isSafeUrl(href)) {
        renderFragments(container, fragment.children, macros, surface, referenceContext, options);
        return;
      }

      let resolvedHref = href;
      let className: string | undefined;
      let title: string | undefined;
      const resolved = referenceContext?.linkResolver?.resolve?.(
        href,
        inlineFragmentsPlainText(fragment.children),
        {
          from: referenceContext.documentPath,
          documentPath: referenceContext.documentPath,
          surface: referenceContext.surface,
        },
      );
      if (resolved) {
        if (resolved.href !== undefined) resolvedHref = resolved.href;
        className = resolved.className;
        title = resolved.title;
      }
      if (!isSafeUrl(resolvedHref)) {
        renderFragments(container, fragment.children, macros, surface, referenceContext, options);
        return;
      }

      const anchor = document.createElement("a");
      applyLinkSurface(anchor, resolvedHref, { className, title });
      applyFragmentSourceAttrs(anchor, fragment, options);
      if (typeof resolved?.onClick === "function") {
        anchor.addEventListener("click", resolved.onClick);
      }
      renderFragments(anchor, fragment.children, macros, surface, referenceContext, options);
      container.appendChild(anchor);
      return;
    }

    case "reference":
      renderReference(container, fragment, policy, referenceContext, options);
      return;

    case "image": {
      const src = fragment.src?.trim();
      if (policy.images === "rendered" && src && isSafeUrl(src)) {
        let renderedSrc = src;
        if (isUnresolvedLocalMediaUrl(src)) {
          const resolvedPath = resolveMarkdownReferencePathFromDocument(
            referenceContext?.documentPath ?? "",
            src,
          );
          renderedSrc = referenceContext?.imageUrlOverrides?.get(resolvedPath) ?? "";
        }
        if (renderedSrc) {
          const media = mediaKindForSrc(renderedSrc) === "pdf" && !isUnresolvedLocalMediaUrl(renderedSrc)
            ? createPdfSurfaceElement(document, "span", renderedSrc, fragment.rawAlt)
            : createImageSurfaceElement(document, "span", renderedSrc, fragment.rawAlt);
          applyFragmentSourceAttrs(media, fragment, options, true);
          container.appendChild(media);
          return;
        }
        const loading = document.createElement("span");
        applyFragmentSourceAttrs(loading, fragment, options, true);
        renderMediaLoadingInto(loading, mediaKindForSrc(src), fragment.rawAlt);
        container.appendChild(loading);
        return;
      }
      renderFragments(container, fragment.alt, macros, surface, referenceContext, options);
      return;
    }

    case "footnote-ref": {
      if (policy.footnotes === "raw-superscript") {
        const sup = document.createElement("sup");
        applyFragmentSourceAttrs(sup, fragment, options, true);
        sup.textContent = fragment.id;
        container.appendChild(sup);
      } else {
        const label = String(referenceContext?.footnoteNumbers?.get(fragment.id) ?? fragment.id);
        const ref = createReaderFootnoteReferenceElement(document, label, fragment.id);
        applyFragmentSourceAttrs(ref, fragment, options, true);
        container.appendChild(ref);
      }
      return;
    }

    case "hard-break":
      container.appendChild(
        policy.hardBreaks === "line-break" ? document.createElement("br") : document.createTextNode(" "),
      );
      return;
  }
}

export function splitByInlineMath(text: string): InlineSegment[] {
  const fragments = parseInlineFragments(text);
  const segments: InlineSegment[] = [];
  let currentText = "";

  const flushText = (): void => {
    if (!currentText) return;
    segments.push({ isMath: false, content: currentText });
    currentText = "";
  };

  for (const fragment of fragments) {
    if (fragment.kind === "math") {
      flushText();
      segments.push({ isMath: true, content: fragment.latex });
      continue;
    }

    if (fragment.kind === "text") {
      currentText += fragment.text;
      continue;
    }

    const scratch = document.createElement("div");
    renderFragment(
      scratch,
      fragment,
      {},
      "document-inline",
      inlineSurfacePolicy("document-inline"),
    );
    currentText += scratch.textContent ?? "";
  }

  flushText();
  return segments;
}

export function renderInlineMarkdown(
  container: HTMLElement,
  text: string,
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
  options: InlineDomRenderOptions = {},
): void {
  if (!text) return;
  renderFragments(
    container,
    parseInlineFragments(text, { sourceRanges: options.sourcePositions }),
    macros,
    surface,
    referenceContext,
    options,
  );
}

export function renderInlineFragmentsToDom(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
  options: InlineDomRenderOptions = {},
): void {
  renderFragments(container, fragments, macros, surface, referenceContext, options);
}

export function renderInlineSyntaxNodeToDom(
  container: HTMLElement | DocumentFragment,
  node: SyntaxNode,
  doc: string,
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
  rangeFrom?: number,
  rangeTo?: number,
  options: InlineDomRenderOptions = {},
): void {
  renderInlineFragmentsToDom(
    container,
    buildInlineFragments(node, doc, rangeFrom, rangeTo, { sourceRanges: options.sourcePositions }),
    macros,
    surface,
    referenceContext,
    options,
  );
}
