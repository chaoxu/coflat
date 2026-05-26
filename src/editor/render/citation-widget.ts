import type { WidgetType } from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import { isSafeUrl } from "../../core/lib/url-utils";
import { ReferenceWidget, SimpleTextReferenceWidget } from "./render-core";

function hostRefClassName(className: string | undefined): string {
  const classNames: string[] = [CSS.crossref];
  for (const token of className?.split(/\s+/) ?? []) {
    if (token !== "" && !classNames.includes(token)) {
      classNames.push(token);
    }
  }
  return classNames.join(" ");
}

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
    const rootClassName = hostRefClassName(className);
    super({
      className: rootClassName,
      ariaLabel: key,
    });
    this.className = rootClassName;
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
