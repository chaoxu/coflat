export interface ReferenceClusterParts {
  readonly ids: readonly string[];
  readonly locators: readonly (string | undefined)[];
}

export interface ReferenceClusterItem {
  readonly id: string;
  /** Normalized text after the item's comma (locator and/or suffix text). */
  readonly locator?: string;
  /** Normalized prefix text before the `@` (Pandoc: `[see @key]`). */
  readonly prefix?: string;
  /** Pandoc suppress-author flag (`-@key`). */
  readonly suppressAuthor?: boolean;
  /** Offset of the `@` within the cluster body. */
  readonly markerFrom: number;
  /** End of the `@id` marker within the cluster body. */
  readonly markerTo: number;
}

export const REFERENCE_ID_SOURCE = "[A-Za-z0-9_][\\w:./'-]*\\w|[A-Za-z0-9_]";
// Pandoc grammar per item: optional prefix text (must end in whitespace, no
// `@`), optional suppress-author `-`, `@id`, optional `, locator/suffix` text.
const REFERENCE_ITEM_SOURCE =
  `(?:[^;\\]\\n@]*[ \\t])?-?@(?:${REFERENCE_ID_SOURCE})(?:,[^;\\]\\n]*)?`;
export const BRACKETED_REFERENCE_BODY_SOURCE =
  `${REFERENCE_ITEM_SOURCE}(?:\\s*;\\s*${REFERENCE_ITEM_SOURCE})*`;

export const BRACKETED_REFERENCE_GLOBAL_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]`,
  "g",
);
export const BRACKETED_REFERENCE_IMPORT_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]`,
);
export const BRACKETED_REFERENCE_SHORTCUT_RE = new RegExp(
  `\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]$`,
);
export const BRACKETED_REFERENCE_EXACT_RE = new RegExp(
  `^\\[(${BRACKETED_REFERENCE_BODY_SOURCE})\\]$`,
);
export const NARRATIVE_REFERENCE_GLOBAL_RE = new RegExp(
  `(?<![[@\\w])-?@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])`,
  "g",
);
export const NARRATIVE_REFERENCE_IMPORT_RE = new RegExp(
  `(?<![[@\\w])-?@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])`,
);
export const NARRATIVE_REFERENCE_SHORTCUT_RE = new RegExp(
  `(?<![[@\\w])-?@(${REFERENCE_ID_SOURCE})(?![\\w@/'-])$`,
);
export const NARRATIVE_REFERENCE_EXACT_RE = new RegExp(
  `^-?@(?:${REFERENCE_ID_SOURCE})$`,
);

const REFERENCE_CLUSTER_ITEM_RE = new RegExp(
  `([^;\\]\\n@]*[ \\t])?(-?)@(${REFERENCE_ID_SOURCE})(?:,([^;\\]\\n]*))?`,
  "y",
);

function normalizeLocator(locator: string): string | undefined {
  return (
    locator
      .replace(/^[\s;,:-]+|[\s;,:-]+$/g, "")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

function normalizePrefix(prefix: string): string | undefined {
  return prefix.replace(/\s+/g, " ").trim() || undefined;
}

export function parseReferenceClusterBody(raw: string): readonly ReferenceClusterItem[] | null {
  const items: ReferenceClusterItem[] = [];
  let pos = 0;

  while (pos < raw.length) {
    REFERENCE_CLUSTER_ITEM_RE.lastIndex = pos;
    const match = REFERENCE_CLUSTER_ITEM_RE.exec(raw);
    if (!match) {
      return null;
    }

    const prefixLength = match[1]?.length ?? 0;
    const suppressAuthor = match[2] === "-";
    const markerFrom = pos + prefixLength + match[2].length;
    const id = match[3] ?? "";
    const markerTo = markerFrom + 1 + id.length;
    const locator = match[4] === undefined ? undefined : normalizeLocator(match[4]);
    const prefix = match[1] === undefined ? undefined : normalizePrefix(match[1]);
    items.push({
      id,
      locator,
      prefix,
      suppressAuthor: suppressAuthor || undefined,
      markerFrom,
      markerTo,
    });

    pos = REFERENCE_CLUSTER_ITEM_RE.lastIndex;
    while (raw[pos] === " " || raw[pos] === "\t") {
      pos += 1;
    }
    if (pos >= raw.length) {
      break;
    }
    if (raw[pos] !== ";") {
      return null;
    }
    pos += 1;
    while (raw[pos] === " " || raw[pos] === "\t") {
      pos += 1;
    }
  }

  return items.length > 0 ? items : null;
}

export function extractReferenceCluster(raw: string): ReferenceClusterParts {
  const parts = parseReferenceClusterBody(raw);
  if (!parts) {
    return { ids: [], locators: [] };
  }

  return {
    ids: parts.map((part) => part.id),
    locators: parts.map((part) => part.locator),
  };
}
