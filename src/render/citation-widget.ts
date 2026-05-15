import type { WidgetType } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { isSafeUrl } from "../lib/url-utils";
import { ReferenceWidget, SimpleTextReferenceWidget } from "./render-core";

/**
 * Widget for a reference whose display text is produced by a host
 * `RefResolver`. The `html` argument is sanitized HTML emitted by the
 * resolver; sanitization happens at plan time (via `sanitizeCslHtml`),
 * not in this widget.
 */
export class HostRefWidget extends ReferenceWidget {
  constructor(
    private readonly html: string,
    private readonly key: string,
    private readonly mode: "bracketed" | "narrative",
    private readonly href: string | undefined,
    className: string | undefined,
    private readonly hasOnClick: boolean,
  ) {
    super({
      className: className
        ? `${CSS.citation} ${className}`
        : CSS.citation,
      ariaLabel: key,
    });
  }

  createDOM(): HTMLElement {
    const root = this.createReferenceRoot();
    root.dataset.refKey = this.key;
    root.dataset.refMode = this.mode;
    if (this.hasOnClick) root.dataset.refResolver = "1";
    if (this.href !== undefined && isSafeUrl(this.href)) {
      const anchor = document.createElement("a");
      anchor.href = this.href;
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
  }
}
