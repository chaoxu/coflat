import type {
  HostReferenceResolution,
  ReferenceMode,
  RefResolver,
  RefResolverEnv,
} from "../document-context-types";
import { escapeHtml } from "../lib/html-escape";
import { isSafeUrl } from "../lib/url-utils";

export type CrossrefKind = "block" | "heading" | "equation" | "unresolved";

export interface ResolvedCrossref {
  readonly kind: CrossrefKind;
  readonly label: string;
  readonly number?: number;
  readonly title?: string;
}

export interface EquationEntry {
  readonly id: string;
  readonly number: number;
}

export type ReferenceClassification =
  | { readonly kind: "crossref"; readonly resolved: ResolvedCrossref }
  | { readonly kind: "citation"; readonly id: string }
  | { readonly kind: "unresolved"; readonly id: string };

export interface ReferencePresentationContext {
  classify: (id: string, preferCitation: boolean) => ReferenceClassification;
  cite: (
    ids: readonly string[],
    locators: readonly (string | undefined)[],
  ) => string;
  citeNarrative: (id: string) => string;
  resolveHostReference?: (
    input: ReferencePresentationInput,
  ) => ReferencePresentationHostRefRoute | null;
}

export interface ReferencePresentationInput {
  readonly bracketed: boolean;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
  readonly raw: string;
  readonly sourceRange?: { readonly from: number; readonly to: number };
}

export interface ReferencePresentationCitationPart {
  readonly kind: "citation";
  readonly id: string;
  readonly text: string;
}

export interface ReferencePresentationCrossrefPart {
  readonly kind: "crossref";
  readonly id: string;
  readonly text: string;
}

export interface ReferencePresentationClusteredCrossrefPart {
  readonly id: string;
  readonly text: string;
  readonly unresolved?: boolean;
}

export interface ReferencePresentationHostRefRoute {
  readonly kind: "host-ref";
  readonly key: string;
  readonly mode: ReferenceMode;
  readonly html: string;
  readonly parts: readonly {
    readonly id: string;
    readonly html: string;
    readonly text: string;
    readonly className?: string;
  }[];
  readonly href?: string;
  readonly className?: string;
  readonly hasOnClick: boolean;
  readonly raw: string;
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export type ReferencePresentationMixedPart =
  | ReferencePresentationCitationPart
  | ReferencePresentationCrossrefPart;

export type ReferencePresentationRoute =
  | { readonly kind: "citation"; readonly rendered: string; readonly ids: readonly string[]; readonly narrative: boolean }
  | { readonly kind: "mixed-cluster"; readonly parts: readonly ReferencePresentationMixedPart[]; readonly raw: string }
  | { readonly kind: "crossref"; readonly resolved: ResolvedCrossref; readonly raw: string }
  | { readonly kind: "clustered-crossref"; readonly parts: readonly ReferencePresentationClusteredCrossrefPart[]; readonly raw: string }
  | { readonly kind: "unresolved"; readonly raw: string }
  | ReferencePresentationHostRefRoute;

export interface ReferenceClassificationOptions {
  readonly bibliography?: Pick<ReadonlyMap<string, unknown>, "has">;
  readonly equationLabels?: ReadonlyMap<string, EquationEntry>;
  readonly preferCitation?: boolean;
}

export interface HostReferenceRouteResolverOptions {
  readonly resolver: RefResolver | undefined;
  readonly resolveCrossref: (id: string) => ResolvedCrossref | null;
  readonly documentPath?: string;
  readonly surface?: string;
  readonly sanitizeContent?: (html: string) => string;
}

function stripOuterParens(text: string): string {
  return text.startsWith("(") && text.endsWith(")")
    ? text.slice(1, -1)
    : text;
}

function citeSingle(
  context: Pick<ReferencePresentationContext, "cite">,
  id: string,
  locator: string | undefined,
): string {
  return context.cite([id], locator === undefined ? [] : [locator]);
}

export function classifyReferenceTarget(
  resolveCrossref: (id: string) => ResolvedCrossref | null,
  id: string,
  options: ReferenceClassificationOptions = {},
): ReferenceClassification {
  const resolved = resolveCrossref(id);
  if (resolved) {
    return { kind: "crossref", resolved };
  }

  if (options.bibliography?.has(id)) {
    return { kind: "citation", id };
  }

  return { kind: "unresolved", id };
}

export function buildReferenceResolverEnv(
  input: ReferencePresentationInput,
  index: number,
  options: Pick<HostReferenceRouteResolverOptions, "documentPath" | "surface">,
): RefResolverEnv {
  return {
    raw: input.raw,
    sourceRange: input.sourceRange,
    locator: input.locators[index],
    cluster: {
      ids: input.ids,
      locators: input.locators,
      index,
      raw: input.raw,
    },
    documentPath: options.documentPath,
    surface: options.surface,
  };
}

function renderResolvedHostReference(
  resolved: HostReferenceResolution,
  sanitizeContent: (html: string) => string,
): string {
  const content = sanitizeContent(resolved.content);
  if (!resolved.href || !isSafeUrl(resolved.href)) {
    return content;
  }
  return `<a href="${escapeHtml(resolved.href)}">${content}</a>`;
}

export function createHostReferenceRouteResolver(
  options: HostReferenceRouteResolverOptions,
): ReferencePresentationContext["resolveHostReference"] | undefined {
  if (!options.resolver?.resolve) return undefined;
  const resolver = options.resolver;

  return (input) => {
    if (input.ids.length === 0) return null;
    const mode: ReferenceMode = input.bracketed ? "bracketed" : "narrative";
    const rendered: string[] = [];
    const parts: Array<ReferencePresentationHostRefRoute["parts"][number]> = [];
    const classNames = new Set<string>();
    let firstHref: string | undefined;
    let hasOnClick = false;
    let hostResolved = false;
    const sanitizeContent = options.sanitizeContent ?? ((html: string) => html);

    for (let index = 0; index < input.ids.length; index += 1) {
      const id = input.ids[index];
      const crossref = options.resolveCrossref(id);
      if (crossref) {
        const html = escapeHtml(crossref.label);
        rendered.push(html);
        parts.push({ id, html, text: crossref.label });
        continue;
      }
      const resolved = resolver.resolve(
        id,
        mode,
        buildReferenceResolverEnv(input, index, options),
      );
      if (!resolved) return null;
      hostResolved = true;
      if (resolved.className) classNames.add(resolved.className);
      if (firstHref === undefined && resolved.href) firstHref = resolved.href;
      if (typeof resolved.onClick === "function") hasOnClick = true;
      const html = renderResolvedHostReference(resolved, sanitizeContent);
      rendered.push(html);
      parts.push({
        id,
        html,
        text: resolved.content.replace(/<[^>]*>/g, ""),
        ...(resolved.className ? { className: resolved.className } : {}),
      });
    }

    if (!hostResolved) return null;

    return {
      kind: "host-ref",
      key: input.ids.join(";"),
      mode,
      html: rendered.join("; "),
      parts,
      href: input.ids.length === 1 ? firstHref : undefined,
      className: classNames.size === 1 ? [...classNames][0] : undefined,
      hasOnClick,
      raw: input.raw,
      ids: input.ids,
      locators: input.locators,
    };
  };
}

export function planReferencePresentation(
  context: ReferencePresentationContext,
  input: ReferencePresentationInput,
): ReferencePresentationRoute | null {
  const classifications = input.ids.map((id) =>
    context.classify(id, input.bracketed),
  );

  if (!input.bracketed) {
    const resolved = classifications[0];
    if (resolved.kind === "crossref") {
      return { kind: "crossref", resolved: resolved.resolved, raw: input.raw };
    }
    if (resolved.kind === "citation") {
      return {
        kind: "citation",
        rendered: context.citeNarrative(input.ids[0]),
        ids: input.ids,
        narrative: true,
      };
    }
    const hostRef = context.resolveHostReference?.(input);
    if (hostRef) return hostRef;
    return { kind: "unresolved", raw: input.raw };
  }

  const hasCitation = classifications.some((classification) => classification.kind === "citation");
  const allCitations = hasCitation
    && classifications.every((classification) => classification.kind === "citation");

  if (allCitations) {
    return {
      kind: "citation",
      rendered: context.cite(input.ids, input.locators),
      ids: input.ids,
      narrative: false,
    };
  }

  const hostRef = context.resolveHostReference?.(input);
  if (hostRef) return hostRef;

  if (hasCitation) {
    const parts: ReferencePresentationMixedPart[] = input.ids.map((id, index) => {
      const classification = classifications[index];
      if (classification.kind === "citation") {
        return {
          kind: "citation" as const,
          id,
          text: stripOuterParens(citeSingle(context, id, input.locators[index])),
        };
      }
      return {
        kind: "crossref" as const,
        id,
        text: classification.kind === "crossref" ? classification.resolved.label : id,
      };
    });
    return { kind: "mixed-cluster", parts, raw: input.raw };
  }

  if (input.ids.length === 1) {
    const resolved = classifications[0];
    return resolved.kind === "crossref"
      ? { kind: "crossref", resolved: resolved.resolved, raw: input.raw }
      : { kind: "unresolved", raw: input.raw };
  }

  const parts = classifications.map((classification, index) => {
    if (classification.kind === "crossref") {
      return {
        id: input.ids[index],
        text: classification.resolved.label,
      };
    }
    return {
      id: input.ids[index],
      text: input.ids[index],
      unresolved: true,
    };
  });

  return { kind: "clustered-crossref", parts, raw: input.raw };
}
