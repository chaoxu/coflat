/**
 * Shared inline markdown renderer for DOM elements.
 *
 * Parsing and fragment building now live in `src/inline-fragments.ts`.
 * This file is intentionally only the DOM render adapter.
 */

import type { SyntaxNode } from "@lezer/common";
import type { InlineRenderSurface } from "../inline-surface";
import {
  CSS,
  mathSurfaceClassNames,
} from "../../core/constants/css-classes";
import { createInlineMarkElement } from "../../core/inline-mark-surface";
import {
  ClusteredCrossrefWidget,
  CrossrefWidget,
  MixedClusterWidget,
  UnresolvedRefWidget,
} from "./crossref-render";
import { CitationWidget } from "./citation-widget";
import {
  buildInlineFragments,
  type InlineFragment,
  parseInlineFragments,
} from "../inline-fragments";
import { isSafeUrl } from "../../core/lib/url-utils";
import { applyLinkSurface } from "../../core/link-surface";
import type { LinkResolver } from "../../core/document-context-types";
import {
  planReferencePresentation,
  type ReferencePresentationContext,
  type ReferencePresentationRoute,
} from "../references/presentation";
import { renderKatexToHtml } from "./inline-shared";
import { HostRefWidget } from "./citation-widget";

interface InlineSegment {
  isMath: boolean;
  content: string;
}

type DomInlineSurface = InlineRenderSurface | "document-body";

export interface InlineReferenceRenderContext extends ReferencePresentationContext {
  readonly linkResolver?: LinkResolver;
  readonly documentPath?: string;
  readonly surface?: string;
}

function renderFragments(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  for (const fragment of fragments) {
    renderFragment(container, fragment, macros, surface, referenceContext);
  }
}

function renderReference(
  container: HTMLElement | DocumentFragment,
  fragment: Extract<InlineFragment, { kind: "reference" }>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  if (surface === "ui-chrome-inline") {
    container.appendChild(document.createTextNode(fragment.rawText));
    return;
  }

  if (!referenceContext) {
    if (!fragment.parenthetical) {
      container.appendChild(document.createTextNode(fragment.rawText));
      return;
    }

    if (fragment.ids.length === 1) {
      const anchor = document.createElement("a");
      anchor.className = "cross-ref";
      anchor.href = `#${fragment.ids[0]}`;
      anchor.textContent = fragment.ids[0];
      if (fragment.parenthetical) {
        const span = document.createElement("span");
        span.className = CSS.crossref;
        span.appendChild(anchor);
        container.appendChild(span);
      } else {
        container.appendChild(anchor);
      }
      return;
    }

    const span = document.createElement("span");
    span.className = CSS.crossref;
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
    container.appendChild(document.createTextNode(raw));
    return;
  }

  renderPresentationRoute(container, route);
}

function renderPresentationRoute(
  container: HTMLElement | DocumentFragment,
  route: ReferencePresentationRoute,
): void {
  switch (route.kind) {
    case "citation":
      container.appendChild(
        new CitationWidget(route.rendered, route.ids, route.narrative).createDOM(),
      );
      return;
    case "mixed-cluster":
      container.appendChild(new MixedClusterWidget(route.parts, route.raw).createDOM());
      return;
    case "crossref":
      container.appendChild(new CrossrefWidget(route.resolved, route.raw).createDOM());
      return;
    case "clustered-crossref":
      container.appendChild(new ClusteredCrossrefWidget(route.parts, route.raw).createDOM());
      return;
    case "unresolved":
      container.appendChild(new UnresolvedRefWidget(route.raw).createDOM());
      return;
    case "host-ref":
      container.appendChild(
        new HostRefWidget(
          route.html,
          route.key,
          route.mode,
          route.href,
          route.className,
          route.hasOnClick,
        ).createDOM(),
      );
      return;
  }
}

function fragmentPlainText(fragments: readonly InlineFragment[]): string {
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
        out += fragmentPlainText(fragment.children);
        break;
      case "link":
        out += fragmentPlainText(fragment.children);
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

function renderFragment(
  container: HTMLElement | DocumentFragment,
  fragment: InlineFragment,
  macros: Record<string, string>,
  surface: DomInlineSurface,
  referenceContext?: InlineReferenceRenderContext,
): void {
  switch (fragment.kind) {
    case "text":
      container.appendChild(document.createTextNode(fragment.text));
      return;

    case "emphasis": {
      const em = createInlineMarkElement(document, "emphasis", { surface });
      renderFragments(em, fragment.children, macros, surface, referenceContext);
      container.appendChild(em);
      return;
    }

    case "strong": {
      const strong = createInlineMarkElement(document, "strong", { surface });
      renderFragments(strong, fragment.children, macros, surface, referenceContext);
      container.appendChild(strong);
      return;
    }

    case "strikethrough": {
      const del = createInlineMarkElement(document, "strikethrough", { surface });
      renderFragments(del, fragment.children, macros, surface, referenceContext);
      container.appendChild(del);
      return;
    }

    case "highlight": {
      const highlight = createInlineMarkElement(document, "highlight", { surface });
      renderFragments(highlight, fragment.children, macros, surface, referenceContext);
      container.appendChild(highlight);
      return;
    }

    case "code": {
      const code = createInlineMarkElement(document, "code", { surface });
      code.textContent = fragment.text;
      container.appendChild(code);
      return;
    }

    case "math": {
      const span = document.createElement("span");
      span.className = mathSurfaceClassNames(false);
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", fragment.latex);
      const renderRawError = (label: string): void => {
        span.className = mathSurfaceClassNames(false, CSS.mathError);
        span.setAttribute("aria-label", label);
        span.textContent = fragment.raw;
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
      if (surface === "ui-chrome-inline") {
        renderFragments(container, fragment.children, macros, surface, referenceContext);
        return;
      }

      const href = fragment.href?.trim();
      if (!href || !isSafeUrl(href)) {
        renderFragments(container, fragment.children, macros, surface, referenceContext);
        return;
      }

      let resolvedHref = href;
      let className: string | undefined;
      let title: string | undefined;
      const resolved = referenceContext?.linkResolver?.resolve?.(
        href,
        fragmentPlainText(fragment.children),
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
        renderFragments(container, fragment.children, macros, surface, referenceContext);
        return;
      }

      const anchor = document.createElement("a");
      applyLinkSurface(anchor, resolvedHref, { className, title });
      if (typeof resolved?.onClick === "function") {
        anchor.addEventListener("click", resolved.onClick);
      }
      renderFragments(anchor, fragment.children, macros, surface, referenceContext);
      container.appendChild(anchor);
      return;
    }

    case "reference":
      renderReference(container, fragment, surface, referenceContext);
      return;

    case "image": {
      const src = fragment.src?.trim();
      if (surface === "document-body" && src && isSafeUrl(src)) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = fragment.rawAlt;
        container.appendChild(img);
        return;
      }
      renderFragments(container, fragment.alt, macros, surface, referenceContext);
      return;
    }

    case "footnote-ref": {
      const sup = document.createElement("sup");
      if (surface === "ui-chrome-inline") {
        sup.textContent = fragment.id;
      } else {
        const anchor = document.createElement("a");
        anchor.className = "footnote-ref";
        anchor.href = `#fn-${fragment.id}`;
        anchor.textContent = fragment.id;
        sup.appendChild(anchor);
      }
      container.appendChild(sup);
      return;
    }

    case "hard-break":
      container.appendChild(
        surface === "document-body" ? document.createElement("br") : document.createTextNode(" "),
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
    renderFragment(scratch, fragment, {}, "document-inline");
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
): void {
  if (!text) return;
  renderFragments(container, parseInlineFragments(text), macros, surface, referenceContext);
}

export function renderInlineFragmentsToDom(
  container: HTMLElement | DocumentFragment,
  fragments: readonly InlineFragment[],
  macros: Record<string, string> = {},
  surface: DomInlineSurface = "document-body",
  referenceContext?: InlineReferenceRenderContext,
): void {
  renderFragments(container, fragments, macros, surface, referenceContext);
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
): void {
  renderInlineFragmentsToDom(
    container,
    buildInlineFragments(node, doc, rangeFrom, rangeTo),
    macros,
    surface,
    referenceContext,
  );
}
