import { describe, expect, it } from "vitest";

import { parseMarkdownSource } from "../parser";
import {
  extractFootnoteDefinition,
  extractFootnoteReference,
} from "./footnote-extraction";

function firstNode(source: string, name: string) {
  const tree = parseMarkdownSource(source, "semantic");
  let found = tree.topNode.getChild(name);
  tree.iterate({
    enter(node) {
      if (!found && node.name === name) found = node.node;
    },
  });
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}

describe("footnote extraction", () => {
  it("extracts footnote references from source ranges", () => {
    const source = "See [^note:1].";
    const node = firstNode(source, "FootnoteRef");

    expect(extractFootnoteReference({ slice: source.slice.bind(source) }, node)).toEqual({
      id: "note:1",
      from: 4,
      to: 13,
    });
  });

  it("extracts footnote definition identity and body ranges", () => {
    const source = "[^note:1]:   Footnote body   ";
    const node = firstNode(source, "FootnoteDef");

    expect(extractFootnoteDefinition(source, node)).toEqual({
      id: "note:1",
      from: 0,
      to: source.length,
      content: "Footnote body",
      bodyFrom: 13,
      bodyTo: 26,
      labelFrom: 0,
      labelTo: 10,
    });
  });
});
