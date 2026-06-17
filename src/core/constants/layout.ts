/**
 * Layout dimension constants used across the Coflat editor and themes.
 *
 * All values are CSS string literals (or percentages) matching the design
 * system so they can be used directly in CM6 theme objects and inline styles.
 */

/**
 * Maximum width of the editor content column.
 * 800 px is a comfortable line length for prose (~75-85 characters in the
 * default serif font), matching the academic/blog column widths that inspired
 * the Coflat design.
 */
export const CONTENT_MAX_WIDTH = "800px";

/**
 * Default right margin reserved for sidenotes and margin annotations.
 * Hosts can opt into a persistent sidenote gutter by setting
 * `--cf-sidenote-margin-width`; the default keeps normal editor documents from
 * reserving an empty column.
 */
export const SIDENOTE_MARGIN_WIDTH = "0px";

/**
 * Horizontal offset of sidenote widgets from the right edge of the viewport.
 * Negative value pulls the widget into the right margin. -280 px places the
 * 240 px widget flush against the margin boundary with ~40 px breathing room.
 */
export const SIDENOTE_OFFSET = "-280px";

/**
 * Width of a sidenote margin widget.
 * 240 px fits approximately 30–35 characters per line in the footnote font
 * size — readable without wrapping excessively for short notes.
 */
export const SIDENOTE_WIDTH = "240px";

/**
 * Maximum height for image widgets in the rendered editor.
 * 400 px caps tall portrait images so they do not dominate the viewport and
 * push surrounding text too far down while reading.
 */
export const IMAGE_MAX_HEIGHT = "400px";

/**
 * Reserved height for block image/PDF preview widgets before their real
 * dimensions are known. This value must match the placeholder min-height used
 * by the editor theme so CodeMirror's virtual height map does not oscillate
 * while offscreen media moves between loading, ready, and error states.
 */
export const IMAGE_PREVIEW_RESERVED_HEIGHT_PX = 100;
export const IMAGE_PREVIEW_RESERVED_HEIGHT = `${IMAGE_PREVIEW_RESERVED_HEIGHT_PX}px`;

/**
 * Vertical padding (top and bottom) for the editor content area.
 * 24 px gives the first and last lines breathing room without wasting
 * significant vertical space on smaller screens.
 */
export const CONTENT_PADDING_Y = "24px";

/**
 * Horizontal padding (left and right) for the editor content area.
 * 48 px keeps text away from the window/sidebar edge and aligns with the
 * left-margin calculation used for headings and block labels.
 */
export const CONTENT_PADDING_X = "48px";

/**
 * Right margin gap on the sidenote number label.
 * 3 px provides a tight but visible separation between the superscript number
 * and the start of the sidenote text.
 */
export const SIDENOTE_NUMBER_MARGIN_RIGHT = "3px";
