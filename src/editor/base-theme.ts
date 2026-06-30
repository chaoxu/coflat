
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

  /* Document-properties form: revealed with the frontmatter YAML. Styled as a
     neutral coflat surface (matching the block-picker / popover conventions),
     not the red active-shell accent. */
  ".cm-panels.cm-panels-top:has(.cf-doc-properties-host)": {
    border: "none",
    background: "transparent",
  },
  ".cf-doc-properties-host": {
    padding: "var(--cf-spacing-sm) var(--cf-doc-content-padding-inline, 16px)",
  },
  ".cf-doc-properties": {
    display: "flex",
    flexDirection: "column",
    gap: "var(--cf-spacing-sm)",
    margin: "0 auto",
    maxWidth: "var(--cf-content-max-width)",
    padding: "var(--cf-spacing-md)",
    fontFamily: "var(--cf-ui-font)",
    fontSize: "var(--cf-ui-font-size-base)",
    lineHeight: "1.4",
    color: "var(--cf-fg)",
    background: "var(--cf-bg)",
    border: "1px solid var(--cf-border)",
    borderRadius: "var(--cf-border-radius-lg)",
  },
  ".cf-doc-properties-heading": {
    fontSize: "var(--cf-ui-font-size-sm)",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--cf-muted)",
  },
  ".cf-doc-properties-row": {
    display: "grid",
    gridTemplateColumns: "6.5em 1fr",
    alignItems: "center",
    gap: "var(--cf-spacing-sm)",
  },
  ".cf-doc-properties-label": {
    fontSize: "var(--cf-ui-font-size-sm)",
    color: "var(--cf-muted)",
  },
  ".cf-doc-properties-input, .cf-doc-properties-macro-name, .cf-doc-properties-macro-value": {
    width: "100%",
    boxSizing: "border-box",
    padding: "4px 8px",
    border: "1px solid var(--cf-border)",
    borderRadius: "var(--cf-border-radius)",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
    fontFamily: "var(--cf-ui-font)",
    fontSize: "var(--cf-ui-font-size-base)",
    outline: "none",
    transition: "border-color var(--cf-transition)",
  },
  ".cf-doc-properties-input:focus, .cf-doc-properties-macro-name:focus, .cf-doc-properties-macro-value:focus": {
    borderColor: "var(--cf-accent)",
  },
  ".cf-doc-properties-input-group": {
    display: "flex",
    gap: "var(--cf-spacing-xs)",
  },
  ".cf-doc-properties-macros": {
    display: "flex",
    flexDirection: "column",
    gap: "var(--cf-spacing-xs)",
  },
  ".cf-doc-properties-macro-row": {
    display: "flex",
    alignItems: "center",
    gap: "var(--cf-spacing-xs)",
  },
  ".cf-doc-properties-macro-name": {
    flex: "0 0 7em",
    fontFamily: "var(--cf-code-font)",
  },
  ".cf-doc-properties-macro-value": {
    flex: "1",
    fontFamily: "var(--cf-code-font)",
  },
  ".cf-doc-properties-macro-preview": {
    flex: "0 0 auto",
    minWidth: "2em",
    textAlign: "center",
    color: "var(--cf-fg)",
  },
  // Every action button (+ add property / + add macro / Browse / Edit as YAML /
  // Back) shares one style.
  ".cf-doc-properties-btn": {
    alignSelf: "flex-start",
    padding: "4px 10px",
    border: "1px solid var(--cf-border)",
    borderRadius: "var(--cf-border-radius)",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
    cursor: "pointer",
    fontFamily: "var(--cf-ui-font)",
    fontSize: "var(--cf-ui-font-size-sm)",
    transition: "background var(--cf-transition), border-color var(--cf-transition)",
  },
  ".cf-doc-properties-btn:hover": {
    background: "var(--cf-hover)",
  },
  ".cf-doc-properties-raw": {
    display: "flex",
    flexDirection: "column",
    gap: "var(--cf-spacing-sm)",
  },
  ".cf-doc-properties-raw-input": {
    width: "100%",
    boxSizing: "border-box",
    padding: "var(--cf-spacing-sm)",
    border: "1px solid var(--cf-border)",
    borderRadius: "var(--cf-border-radius)",
    background: "var(--cf-bg)",
    color: "var(--cf-fg)",
    fontFamily: "var(--cf-code-font)",
    fontSize: "var(--cf-ui-font-size-sm)",
    lineHeight: "1.5",
    resize: "vertical",
    outline: "none",
    transition: "border-color var(--cf-transition)",
  },
  ".cf-doc-properties-raw-input:focus": {
    borderColor: "var(--cf-accent)",
  },
  ".cf-doc-properties-macro-remove": {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.6em",
    height: "1.6em",
    padding: "0",
    border: "1px solid transparent",
    borderRadius: "var(--cf-border-radius)",
    background: "transparent",
    color: "var(--cf-muted)",
    cursor: "pointer",
    fontSize: "1.1em",
    lineHeight: "1",
    transition: "background var(--cf-transition), color var(--cf-transition)",
  },
  ".cf-doc-properties-macro-remove:hover": {
    background: "var(--cf-hover)",
    color: "var(--cf-fg)",
  },
};
