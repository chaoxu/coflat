export interface HeadingAnchorInput {
  readonly from: number;
  readonly text: string;
  readonly id?: string;
}

/** Canonical heading slug: fold diacritics, lowercase, non-alphanumeric runs
 * to "-", trimmed. Empty slugs fall back to "section". */
export function slugifyHeadingAnchor(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "section";
}

export function reserveExplicitHeadingAnchorIds(
  headings: Iterable<Pick<HeadingAnchorInput, "id">>,
): Set<string> {
  const used = new Set<string>();
  for (const heading of headings) {
    if (heading.id) {
      used.add(heading.id);
    }
  }
  return used;
}

export function uniqueHeadingAnchorId(
  heading: Pick<HeadingAnchorInput, "text" | "id">,
  usedIds: Set<string>,
): string {
  if (heading.id) {
    usedIds.add(heading.id);
    return heading.id;
  }

  const root = slugifyHeadingAnchor(heading.text);
  let candidate = root;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${root}-${suffix++}`;
  }
  usedIds.add(candidate);
  return candidate;
}

export function buildHeadingAnchorIds(
  headings: readonly HeadingAnchorInput[],
): ReadonlyMap<number, string> {
  const usedIds = reserveExplicitHeadingAnchorIds(headings);
  return new Map(
    headings.map((heading) => [
      heading.from,
      uniqueHeadingAnchorId(heading, usedIds),
    ]),
  );
}
