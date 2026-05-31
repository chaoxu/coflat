import { SAFE_URL_PROTOCOLS } from "./lib/url-utils";

export const LINK_LAYOUT_ATTRIBUTE = "data-cf-link-layout";

export type LinkLayout = "atomic" | "flow";

const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function linkLayoutForHref(href: string): LinkLayout {
  const cleaned = href.replace(/\s/g, "");
  if (!URL_SCHEME_RE.test(cleaned)) return "atomic";

  try {
    return SAFE_URL_PROTOCOLS.has(new URL(cleaned).protocol) ? "flow" : "atomic";
  } catch {
    return "atomic";
  }
}
