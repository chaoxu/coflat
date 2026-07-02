import type { WidgetType } from "@codemirror/view";
import { CSS, hostReferenceClassNames } from "../../core/constants/css-classes";
import { isSafeUrl } from "../../core/lib/url-utils";
import { applyLinkSurface } from "../../core/link-surface";
import { applyReferenceSurface } from "../../core/reference-surface";
import { ReferenceWidget, SimpleTextReferenceWidget } from "./render-core";

/**
 * Widget for a reference whose display text is produced by a host
 * `RefResolver`. The `html` argument is sanitized HTML emitted by the
 * resolver; sanitization happens at plan time (via `sanitizeCslHtml`),
 * not in this widget.
 */
export class HostRefWidget extends ReferenceWidget {
  private readonly className: string;

  constructor(
    private readonly html: string,
    private readonly key: string,
    private readonly mode: "bracketed" | "narrative",
    private readonly href: string | undefined,
    className: string | undefined,
    private readonly hasOnClick: boolean,
  ) {
    const rootClassName = hostReferenceClassNames(className);
    super({
      className: rootClassName,
      ariaLabel: key,
    });
    this.className = rootClassName;
  }

  createDOM(): HTMLElement {
    const root = this.createReferenceRoot();
    applyReferenceSurface(root, {
      className: this.className,
      refKey: this.key,
      refMode: this.mode,
    });
    root.dataset.referenceWidget = "true";
    if (this.hasOnClick) {
      root.dataset.refResolver = "1";
    }
    if (this.hasOnClick && this.href === undefined) {
      root.tabIndex = 0;
      root.setAttribute("role", "button");
    }
    if (this.href !== undefined && isSafeUrl(this.href)) {
      const anchor = document.createElement("a");
      applyLinkSurface(anchor, this.href);
      anchor.innerHTML = this.html;
      root.appendChild(anchor);
    } else {
      root.innerHTML = this.html;
    }
    return root;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof HostRefWidget &&
      this.html === other.html &&
      this.key === other.key &&
      this.mode === other.mode &&
      this.href === other.href &&
      this.className === other.className &&
      this.hasOnClick === other.hasOnClick
    );
  }
}

/**
 * Widget that renders a citation reference.
 *
 * Handles both parenthetical citations like "(Karger, 2000)" and narrative
 * citations like "Karger (2000)". Pass `narrative: true` for the latter.
 */
export class CitationWidget extends SimpleTextReferenceWidget {
  private readonly refKey: string;
  private readonly refMode: "bracketed" | "narrative";

  constructor(
    text: string,
    ids: readonly string[],
    narrative: boolean = false,
  ) {
    super({
      className: narrative ? CSS.citationNarrative : CSS.citation,
      text,
      ariaLabel: ids.join("; "),
    });
    this.refKey = ids.join(";");
    this.refMode = narrative ? "narrative" : "bracketed";
  }

  createDOM(): HTMLElement {
    const root = super.createDOM();
    if (this.refKey) root.dataset.refKey = this.refKey;
    root.dataset.refMode = this.refMode;
    return root;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CitationWidget &&
      this.spec.text === other.spec.text &&
      this.refKey === other.refKey &&
      this.refMode === other.refMode &&
      this.hasSameReferenceRoot(other)
    );
  }
}
