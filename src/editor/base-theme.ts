
import {
  CONTENT_MAX_WIDTH,
  CONTENT_PADDING_X,
  CONTENT_PADDING_Y,
  SIDENOTE_MARGIN_WIDTH,
} from "../core/constants/layout";

/**
 * Base editor chrome styles: container, content area, gutters, cursor,
 * selection, active line, and fold toggles.
 */
export const baseThemeStyles = {
  "&": {
    fontSize: "var(--cf-base-font-size, 16px)",
    fontFamily: "var(--cf-content-font, KaTeX_Main, 'Times New Roman', serif)",
    position: "relative",
  },
  ".cm-content": {
    fontFamily: "var(--cf-content-font, KaTeX_Main, 'Times New Roman', serif)",
    padding: `var(--cf-doc-content-padding-block-start, ${CONTENT_PADDING_Y}) var(--cf-doc-content-padding-inline, ${CONTENT_PADDING_X}) var(--cf-doc-content-padding-block-end, ${CONTENT_PADDING_Y}) var(--cf-doc-content-padding-inline, ${CONTENT_PADDING_X})`,
    boxSizing: "border-box",
    width: "100%",
    maxWidth: `min(var(--cf-content-max-width, ${CONTENT_MAX_WIDTH}), 100%)`,
    marginLeft: "auto",
    marginRight: `max(var(--cf-sidenote-margin-width, ${SIDENOTE_MARGIN_WIDTH}), calc((100% - var(--cf-content-max-width, ${CONTENT_MAX_WIDTH})) / 2))`,
    overflow: "visible",
    lineHeight: "var(--cf-line-height, 1.5)",
  },
  "@media (max-width: 720px)": {
    ".cm-content": {
      paddingInline: "var(--cf-doc-content-padding-inline-compact, var(--cf-doc-content-padding-inline, 20px))",
      marginRight: "auto",
    },
  },
  ".cm-gutters": {
    display: "none",
  },
  /* Fold toggle sits in the left margin outside the line */
  ".cf-fold-line": {
    position: "relative",
  },
  ".cf-fold-rail-line": {
    position: "relative",
  },
  ".cf-fold-rail-overlay": {
    background: "var(--cf-block-disclosure-indicator-color, color-mix(in srgb, var(--cf-fg) 45%, transparent))",
    pointerEvents: "none",
    position: "absolute",
    transform: "translateX(-50%)",
    transition: "opacity var(--cf-transition, 0.15s ease)",
    width: "var(--cf-border-width-accent, 2px)",
    zIndex: "1",
  },
  ".cf-fold-rail-overlay[hidden]": {
    display: "none",
  },
  ".cf-fold-toggle": {
    position: "absolute",
    right: "100%",
    marginRight: "var(--cf-spacing-xs)",
    color: "var(--cf-border)",
    fontSize: "var(--cf-ui-font-size-base)",
    fontStyle: "normal",
    cursor: "pointer",
    userSelect: "none",
    lineHeight: "inherit",
    opacity: "0",
    transition: "opacity var(--cf-transition, 0.15s ease)",
  },
  /* Chevron icon scales with the per-level font size; color via currentColor. */
  ".cf-fold-toggle svg": {
    width: "1em",
    height: "1em",
    display: "block",
  },
  /* Show fold toggle when hovering the heading line */
  ".cm-line:hover .cf-fold-toggle": {
    opacity: "1",
  },
  ".cf-fold-rail-heading-active .cf-fold-toggle": {
    opacity: "1",
  },
  /* Always show fold toggle when section is folded */
  ".cf-fold-toggle-folded": {
    opacity: "1",
  },
  ".cf-fold-toggle:hover": {
    color: "var(--cf-fg)",
  },
  /* Fold toggle sizes per heading level */
  ".cf-fold-h1": { fontSize: "24px" },
  ".cf-fold-h2": { fontSize: "20px" },
  ".cf-fold-h3": { fontSize: "16px" },
  ".cm-cursor": {
    borderLeftColor: "var(--cf-fg)",
    borderLeftWidth: "var(--cf-border-width-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--cf-hover)",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },

  /* Focus mode: dim non-active paragraphs */
  ".cf-focus-dimmed": {
    opacity: "0.3",
    transition: "opacity var(--cf-transition, 0.15s ease)",
  },

  /* Title-less frontmatter is hidden in rich mode by collapsing its lines.
   * Non-empty lines collapse via a 0-height block widget; empty separator lines
   * carry no text to replace, so they collapse to zero height here. */
  ".cm-line.cf-frontmatter-hidden": {
    height: "0",
    minHeight: "0",
    padding: "0",
    lineHeight: "0",
    fontSize: "0",
    overflow: "hidden",
  },

  /* Document-properties panel (rich-mode metadata chip + form). */
  ".cf-doc-properties": {
    fontFamily: "var(--cf-ui-font, system-ui, sans-serif)",
    fontSize: "var(--cf-ui-font-size-base, 13px)",
    margin: "0 0 0.75em 0",
  },
  ".cf-doc-properties-chip": {
    display: "flex",
    alignItems: "baseline",
    gap: "0.4em",
    width: "100%",
    padding: "0.25em 0.5em",
    background: "var(--cf-hover, rgba(0,0,0,0.04))",
    border: "1px solid var(--cf-border)",
    borderRadius: "6px",
    color: "var(--cf-fg)",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
  },
  ".cf-doc-properties-caret": {
    color: "var(--cf-muted)",
  },
  ".cf-doc-properties-sub": {
    color: "var(--cf-muted)",
    marginLeft: "0.5em",
  },
  ".cf-doc-properties-panel": {
    display: "flex",
    flexDirection: "column",
    gap: "0.4em",
    padding: "0.6em 0.5em",
    border: "1px solid var(--cf-border)",
    borderTop: "none",
    borderRadius: "0 0 6px 6px",
  },
  ".cf-doc-properties-row": {
    display: "grid",
    gridTemplateColumns: "7em 1fr",
    alignItems: "center",
    gap: "0.5em",
  },
  ".cf-doc-properties-label": {
    color: "var(--cf-muted)",
  },
  ".cf-doc-properties-input": {
    width: "100%",
    padding: "0.2em 0.4em",
    border: "1px solid var(--cf-border)",
    borderRadius: "4px",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
    font: "inherit",
  },
  ".cf-doc-properties-input-group": {
    display: "flex",
    gap: "0.3em",
  },
  ".cf-doc-properties-macros": {
    display: "flex",
    flexDirection: "column",
    gap: "0.3em",
  },
  ".cf-doc-properties-macro-row": {
    display: "flex",
    alignItems: "center",
    gap: "0.3em",
  },
  ".cf-doc-properties-macro-name": {
    width: "7em",
    fontFamily: "var(--cf-mono-font, ui-monospace, monospace)",
    padding: "0.15em 0.3em",
    border: "1px solid var(--cf-border)",
    borderRadius: "4px",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
  },
  ".cf-doc-properties-macro-value": {
    flex: "1",
    fontFamily: "var(--cf-mono-font, ui-monospace, monospace)",
    padding: "0.15em 0.3em",
    border: "1px solid var(--cf-border)",
    borderRadius: "4px",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
  },
  ".cf-doc-properties-macro-preview": {
    minWidth: "2em",
    color: "var(--cf-fg)",
  },
  ".cf-doc-properties-browse, .cf-doc-properties-add-macro, .cf-doc-properties-yaml, .cf-doc-properties-macro-remove": {
    padding: "0.15em 0.5em",
    border: "1px solid var(--cf-border)",
    borderRadius: "4px",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
    cursor: "pointer",
    font: "inherit",
  },
  ".cf-doc-properties-actions": {
    marginTop: "0.3em",
  },
};
