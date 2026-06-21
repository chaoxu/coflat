import { escapeHtml } from "./lib/html-escape";
import { isSafeUrl } from "./lib/url-utils";
import { renderLinkSurfaceHtml } from "./link-surface";
import {
  applySourceRangeAttrs,
  clearSourceRangeAttrs,
  sourceRangeAttrs,
  type SourceRange,
} from "./source-range-surface";
import { CSS, hostReferenceClassNames } from "./constants/css-classes";
import type {
  ReferencePresentationInput,
  ReferencePresentationRoute,
} from "./references/presentation";

export type ReferenceMode = "bracketed" | "narrative";

export interface ReferenceSurfaceSpec {
  readonly className: string;
  readonly refKey?: string;
  readonly refMode?: ReferenceMode;
  readonly refResolver?: boolean;
  readonly sourceAttrs?: string;
  readonly sourceAtomic?: boolean;
  readonly sourceRange?: SourceRange;
}

export interface ReferenceListItemSpec {
  readonly className?: string;
  readonly id: string;
  readonly innerHtml?: string;
  readonly refKey?: string;
  readonly refMode?: ReferenceMode;
  readonly text?: string;
}

export interface ReferenceListSurfaceSpec extends ReferenceSurfaceSpec {
  readonly items: readonly ReferenceListItemSpec[];
  readonly prefixText?: string;
  readonly separatorText?: string;
  readonly suffixText?: string;
}

export type ReferenceRouteSurfacePlan =
  | {
    readonly kind: "text";
    readonly html: string;
    readonly text: string;
  }
  | {
    readonly kind: "single";
    readonly innerHtml: string;
    readonly spec: ReferenceSurfaceSpec;
    readonly text: string;
  }
  | {
    readonly kind: "list";
    readonly spec: ReferenceListSurfaceSpec;
    readonly text: string;
  };

export interface ReferenceRouteSurfaceOptions {
  readonly hasCrossrefTarget?: (id: string) => boolean;
  readonly sourceAttrs?: string;
  readonly sourceAtomic?: boolean;
  readonly sourceRange?: SourceRange;
}

export function referencePresentationRouteText(route: ReferencePresentationRoute): string {
  switch (route.kind) {
    case "citation":
      return route.rendered;
    case "mixed-cluster":
      return route.parts.map((part) => part.text).join("; ");
    case "crossref":
      return route.resolved.label;
    case "clustered-crossref":
      return route.parts.map((part) => part.text).join("; ");
    case "unresolved":
      return route.raw;
    case "host-ref":
      return route.parts.length > 0
        ? route.parts.map((part) => part.text).join("; ")
        : route.html.replace(/<[^>]*>/g, "");
  }
}

function crossrefInnerHtml(
  id: string,
  label: string,
  hasCrossrefTarget: ((id: string) => boolean) | undefined,
): string {
  return hasCrossrefTarget?.(id)
    ? `<a href="#${escapeHtml(encodeURIComponent(id))}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

export function referencePresentationRouteSurfacePlan(
  input: ReferencePresentationInput,
  route: ReferencePresentationRoute,
  options: ReferenceRouteSurfaceOptions = {},
): ReferenceRouteSurfacePlan {
  const mode = input.bracketed ? "bracketed" : "narrative";
  const sourceSpec = referenceSourceSpec(options);
  switch (route.kind) {
    case "citation":
      if (!route.rendered) {
        return {
          kind: "text",
          html: escapeHtml(input.raw),
          text: input.raw,
        };
      }
      if (!input.ids.length) {
        return {
          kind: "text",
          html: escapeHtml(route.rendered),
          text: route.rendered,
        };
      }
      return {
        kind: "single",
        innerHtml: escapeHtml(route.rendered),
        spec: {
          className: route.narrative ? CSS.citationNarrative : CSS.citation,
          refKey: input.ids.join(";"),
          refMode: mode,
          ...sourceSpec,
        },
        text: route.rendered,
      };
    case "mixed-cluster":
      return {
        kind: "list",
        spec: {
          className: CSS.citation,
          refMode: mode,
          items: route.parts.map((part) => ({
            id: part.id,
            text: part.text,
            refMode: mode,
          })),
          prefixText: "(",
          separatorText: "; ",
          suffixText: ")",
          ...sourceSpec,
        },
        text: referencePresentationRouteText(route),
      };
    case "crossref": {
      const id = input.ids[0] ?? "";
      return {
        kind: "single",
        innerHtml: crossrefInnerHtml(id, route.resolved.label, options.hasCrossrefTarget),
        spec: {
          className: CSS.crossref,
          refKey: id,
          refMode: mode,
          ...sourceSpec,
        },
        text: route.resolved.label,
      };
    }
    case "clustered-crossref":
      return {
        kind: "list",
        spec: {
          className: CSS.citationCluster,
          refMode: mode,
          items: route.parts.map((part) => ({
            className: part.unresolved ? CSS.crossrefUnresolved : CSS.crossref,
            id: part.id,
            innerHtml: part.unresolved
              ? escapeHtml(part.text)
              : crossrefInnerHtml(part.id, part.text, options.hasCrossrefTarget),
            refMode: mode,
          })),
          separatorText: "; ",
          ...sourceSpec,
        },
        text: referencePresentationRouteText(route),
      };
    case "unresolved":
      return {
        kind: "single",
        innerHtml: escapeHtml(route.raw),
        spec: {
          className: CSS.crossrefUnresolved,
          refKey: input.ids[0],
          refMode: mode,
          ...sourceSpec,
        },
        text: route.raw,
      };
    case "host-ref": {
      if (route.parts.length > 1) {
        return {
          kind: "list",
          spec: {
            className: CSS.citationCluster,
            refMode: route.mode,
            items: route.parts.map((part) => ({
              className: hostReferenceClassNames(part.className),
              id: part.id,
              innerHtml: part.html,
              refMode: route.mode,
            })),
            separatorText: "; ",
            ...sourceSpec,
          },
          text: referencePresentationRouteText(route),
        };
      }
      return {
        kind: "single",
        innerHtml: route.href && isSafeUrl(route.href)
          ? renderLinkSurfaceHtml(route.href, route.html)
          : route.html,
        spec: {
          className: hostReferenceClassNames(route.className),
          refKey: route.key,
          refMode: route.mode,
          refResolver: route.hasOnClick,
          ...sourceSpec,
        },
        text: referencePresentationRouteText(route),
      };
    }
  }
}

function referenceSourceSpec(
  options: ReferenceRouteSurfaceOptions,
): Pick<ReferenceSurfaceSpec, "sourceAttrs" | "sourceAtomic" | "sourceRange"> {
  return {
    sourceAttrs: options.sourceAttrs,
    sourceAtomic: options.sourceAtomic,
    sourceRange: options.sourceRange,
  };
}

export function renderReferenceSurfaceHtml(
  innerHtml: string,
  spec: ReferenceSurfaceSpec,
): string {
  let attrs = ` class="${escapeHtml(spec.className)}"`;
  if (spec.refKey !== undefined) {
    attrs += ` data-ref-key="${escapeHtml(spec.refKey)}"`;
  }
  if (spec.refMode !== undefined) {
    attrs += ` data-ref-mode="${escapeHtml(spec.refMode)}"`;
  }
  if (spec.refResolver) {
    attrs += ' data-ref-resolver="1"';
  }
  if (spec.sourceAttrs) {
    attrs += spec.sourceAttrs;
  } else if (spec.sourceRange) {
    attrs += sourceRangeAttrs({
      sourceAtomic: spec.sourceAtomic,
      sourceRange: spec.sourceRange,
    });
  }
  return `<span${attrs}>${innerHtml}</span>`;
}

function referenceItemAttrs(item: ReferenceListItemSpec): string {
  let attrs = ` data-ref-id="${escapeHtml(item.id)}"`;
  const refKey = item.refKey ?? item.id;
  attrs += ` data-ref-key="${escapeHtml(refKey)}"`;
  if (item.refMode !== undefined) {
    attrs += ` data-ref-mode="${escapeHtml(item.refMode)}"`;
  }
  if (item.className) {
    attrs += ` class="${escapeHtml(item.className)}"`;
  }
  return attrs;
}

export function renderReferenceListSurfaceHtml(
  spec: ReferenceListSurfaceSpec,
): string {
  const pieces: string[] = [];
  if (spec.prefixText) pieces.push(escapeHtml(spec.prefixText));
  for (let index = 0; index < spec.items.length; index += 1) {
    if (index > 0 && spec.separatorText) {
      pieces.push(escapeHtml(spec.separatorText));
    }
    const item = spec.items[index];
    const inner = item.innerHtml ?? escapeHtml(item.text ?? "");
    pieces.push(`<span${referenceItemAttrs(item)}>${inner}</span>`);
  }
  if (spec.suffixText) pieces.push(escapeHtml(spec.suffixText));
  return renderReferenceSurfaceHtml(pieces.join(""), spec);
}

export function renderReferenceRouteSurfaceHtml(plan: ReferenceRouteSurfacePlan): string {
  switch (plan.kind) {
    case "text":
      return plan.html;
    case "single":
      return renderReferenceSurfaceHtml(plan.innerHtml, plan.spec);
    case "list":
      return renderReferenceListSurfaceHtml(plan.spec);
  }
}

export function applyReferenceSurface(
  el: HTMLElement,
  spec: ReferenceSurfaceSpec,
): void {
  el.className = spec.className;
  if (spec.refKey !== undefined) {
    el.dataset.refKey = spec.refKey;
  } else {
    delete el.dataset.refKey;
  }
  if (spec.refMode !== undefined) {
    el.dataset.refMode = spec.refMode;
  } else {
    delete el.dataset.refMode;
  }
  if (spec.refResolver) {
    el.dataset.refResolver = "1";
  } else {
    delete el.dataset.refResolver;
  }
  applyReferenceSourceAttrs(el, spec);
}

function applyReferenceSourceAttrs(
  el: HTMLElement,
  spec: ReferenceSurfaceSpec,
): void {
  if (spec.sourceRange) {
    clearSourceRangeAttrs(el);
    applySourceRangeAttrs(el, {
      sourceAtomic: spec.sourceAtomic,
      sourceRange: spec.sourceRange,
    });
    return;
  }

  clearSourceRangeAttrs(el);
}

export function createReferenceSurfaceDom(
  ownerDocument: Document,
  innerHtml: string,
  spec: ReferenceSurfaceSpec,
): HTMLElement {
  const el = ownerDocument.createElement("span");
  applyReferenceSurface(el, spec);
  el.dataset.referenceWidget = "true";
  el.innerHTML = innerHtml;
  return el;
}

export function appendReferenceListSurfaceDom(
  container: HTMLElement,
  spec: ReferenceListSurfaceSpec,
): void {
  const ownerDocument = container.ownerDocument;
  if (spec.prefixText) {
    container.appendChild(ownerDocument.createTextNode(spec.prefixText));
  }
  for (let index = 0; index < spec.items.length; index += 1) {
    if (index > 0 && spec.separatorText) {
      container.appendChild(ownerDocument.createTextNode(spec.separatorText));
    }
    const item = spec.items[index];
    const span = ownerDocument.createElement("span");
    span.dataset.refId = item.id;
    span.dataset.refKey = item.refKey ?? item.id;
    if (item.refMode !== undefined) span.dataset.refMode = item.refMode;
    if (item.className) span.className = item.className;
    if (item.innerHtml !== undefined) {
      span.innerHTML = item.innerHtml;
    } else {
      span.textContent = item.text ?? "";
    }
    container.appendChild(span);
  }
  if (spec.suffixText) {
    container.appendChild(ownerDocument.createTextNode(spec.suffixText));
  }
}

export function createReferenceListSurfaceDom(
  ownerDocument: Document,
  spec: ReferenceListSurfaceSpec,
): HTMLElement {
  const container = ownerDocument.createElement("span");
  applyReferenceSurface(container, spec);
  container.dataset.referenceWidget = "true";
  appendReferenceListSurfaceDom(container, spec);
  return container;
}

export function appendReferenceRouteSurfaceDom(
  container: HTMLElement | DocumentFragment,
  plan: ReferenceRouteSurfacePlan,
): void {
  const ownerDocument = container.ownerDocument;
  switch (plan.kind) {
    case "text":
      container.appendChild(ownerDocument.createTextNode(plan.text));
      return;
    case "single":
      container.appendChild(createReferenceSurfaceDom(ownerDocument, plan.innerHtml, plan.spec));
      return;
    case "list":
      container.appendChild(createReferenceListSurfaceDom(ownerDocument, plan.spec));
      return;
  }
}
