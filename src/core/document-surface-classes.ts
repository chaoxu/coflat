/**
 * Shared document-surface class names used by CM6 rich and source rendering.
 * Editor-specific classes can still exist, but these classes are the
 * canonical document-surface visual contract.
 */

export const DOCUMENT_SURFACE_CLASS = {
  surface: "cf-doc-surface",
  flow: "cf-doc-flow",
  paragraph: "cf-doc-paragraph",
  blockquote: "cf-doc-blockquote",
  heading: "cf-doc-heading",
  headingLevel: (level: number) => `cf-doc-heading--h${level}`,
  list: "cf-doc-list",
  listOrdered: "cf-doc-list--ordered",
  listUnordered: "cf-doc-list--unordered",
  listCheck: "cf-doc-list--check",
  listLoose: "cf-doc-list--loose",
  listTight: "cf-doc-list--tight",
  listItem: "cf-doc-list-item",
  listItemCheck: "cf-doc-list-item--check",
  link: "cf-doc-link",
  inlineMath: "cf-doc-inline-math",
  codeBlock: "cf-doc-code-block",
  codeToken: "cf-doc-code-token",
  displayMath: "cf-doc-display-math",
  block: "cf-doc-block",
  blockType: (type: string) => `cf-doc-block--${type}`,
  blockHeader: "cf-doc-block-header",
  blockLabel: "cf-doc-block-label",
  blockTitle: "cf-doc-block-title",
  blockBody: "cf-doc-block-body",
  blockCaption: "cf-doc-block-caption",
  tableBlock: "cf-doc-table-block",
  tableRow: "cf-doc-table-row",
  tableCell: "cf-doc-table-cell",
  tableHeader: "cf-doc-table-header",
} as const;

export function documentSurfaceClassNames(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
