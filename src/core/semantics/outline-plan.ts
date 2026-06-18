import {
  buildHeadingAnchorIds,
  uniqueHeadingAnchorId,
  type HeadingAnchorInput,
} from "./heading-anchors";
import {
  headingOutlineEntry,
  type DocumentOutlineEntry,
} from "../outline-surface";

export interface HeadingOutlineProjectionInput extends HeadingAnchorInput {
  readonly level: number;
  readonly number?: string;
}

export interface HeadingOutlineProjectionEntry extends DocumentOutlineEntry {
  readonly markdown: string;
  readonly from: number;
}

export interface HeadingOutlineProjectionOptions<THeading extends HeadingOutlineProjectionInput> {
  readonly markdown: (heading: THeading) => string;
  readonly html: (heading: THeading, markdown: string) => string;
  readonly displayUnnumbered?: (heading: THeading) => boolean;
}

export function headingOutlineProjectionEntry<THeading extends HeadingOutlineProjectionInput>(
  heading: THeading,
  id: string,
  options: HeadingOutlineProjectionOptions<THeading>,
): HeadingOutlineProjectionEntry {
  const markdown = options.markdown(heading);
  return {
    ...headingOutlineEntry({
      id,
      markdown,
      html: options.html(heading, markdown),
      level: heading.level,
      number: heading.number,
      displayUnnumbered: options.displayUnnumbered?.(heading) ?? !heading.number,
    }),
    markdown,
    from: heading.from,
  };
}

export function nextHeadingOutlineProjectionEntry<THeading extends HeadingOutlineProjectionInput>(
  heading: THeading,
  usedIds: Set<string>,
  options: HeadingOutlineProjectionOptions<THeading>,
): HeadingOutlineProjectionEntry {
  return headingOutlineProjectionEntry(
    heading,
    uniqueHeadingAnchorId(heading, usedIds),
    options,
  );
}

export function buildHeadingOutlineProjection<THeading extends HeadingOutlineProjectionInput>(
  headings: readonly THeading[],
  options: HeadingOutlineProjectionOptions<THeading>,
): readonly HeadingOutlineProjectionEntry[] {
  const ids = buildHeadingAnchorIds(headings);
  return headings.map((heading) => {
    const id = ids.get(heading.from);
    if (!id) {
      throw new Error(`Missing heading outline id at ${heading.from}`);
    }
    return headingOutlineProjectionEntry(heading, id, options);
  });
}
