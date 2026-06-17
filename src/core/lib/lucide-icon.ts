/**
 * Build a Lucide icon as a detached SVG DOM node.
 *
 * Lucide ships each icon's geometry as an `__iconNode` array of
 * `[tag, attributes]` tuples (pure data, no React). Call sites import the
 * specific `__iconNode` they need and pass it here; this module imports no
 * icons itself, so the core layer stays free of a lucide dependency.
 *
 * Shared by the editor (code-block copy button, fold gutter) and the reader
 * (block/section disclosure toggles) so every surface renders identical icons.
 */

/** Lucide's `__iconNode` shape: a list of `[svgChildTag, attributes]` tuples. */
export type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create a 24×24 stroke SVG from a Lucide `__iconNode`. The icon inherits color
 * via `stroke="currentColor"`; size it with CSS (e.g. `svg { width: 1em }`).
 *
 * @param iconNode The icon geometry (`__iconNode` export from a lucide-react
 *   icon module).
 * @param name Optional icon name; adds a `lucide-${name}` class (matching
 *   lucide-react's own output) for CSS hooks and testing.
 */
export function createLucideIcon(iconNode: IconNode, name?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("lucide");
  if (name) svg.classList.add(`lucide-${name}`);

  for (const [tag, attrs] of iconNode) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [attrName, value] of Object.entries(attrs)) {
      if (attrName === "key") continue;
      child.setAttribute(attrName, value);
    }
    svg.appendChild(child);
  }

  return svg;
}
