export interface HeadingBoundaryInput {
  readonly level: number;
}

export function headingBoundaryIndices(
  headings: readonly HeadingBoundaryInput[],
): readonly (number | null)[] {
  const nextHeadingIndexByLevel: Array<number | undefined> = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  const boundaryIndices: Array<number | null> = new Array(headings.length);

  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    let nextBoundaryIndex: number | null = null;

    for (let level = 1; level <= heading.level; level++) {
      const candidate = nextHeadingIndexByLevel[level];
      if (
        candidate !== undefined &&
        (nextBoundaryIndex === null || candidate < nextBoundaryIndex)
      ) {
        nextBoundaryIndex = candidate;
      }
    }

    boundaryIndices[index] = nextBoundaryIndex;
    nextHeadingIndexByLevel[heading.level] = index;
  }

  return boundaryIndices;
}

export function headingSectionEndOffsets(
  headings: readonly (HeadingBoundaryInput & { readonly from: number })[],
  documentEnd: number,
): readonly number[] {
  const boundaries = headingBoundaryIndices(headings);
  return headings.map((_heading, index) => {
    const boundaryIndex = boundaries[index];
    return boundaryIndex === null ? documentEnd : headings[boundaryIndex].from;
  });
}
