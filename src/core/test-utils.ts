/**
 * Pure test helpers usable from core/ tests.
 *
 * Lives in core/ so .test.ts files inside core/ can import shared parser
 * helpers without violating the layer rule. The richer test-utils.ts at
 * src/test-utils.ts (which depends on CodeMirror, vitest mocks, etc.) is
 * editor-layer.
 */

import { expect } from "vitest";
import type { Parser } from "@lezer/common";

export interface NodeInfo {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

export function parseNodeNames(text: string, parser: Parser): string[] {
  const tree = parser.parse(text);
  const names: string[] = [];
  tree.iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

export function parseNodeInfos(text: string, parser: Parser): NodeInfo[] {
  const tree = parser.parse(text);
  const infos: NodeInfo[] = [];
  tree.iterate({
    enter(node) {
      infos.push({
        name: node.name,
        from: node.from,
        to: node.to,
        text: text.slice(node.from, node.to),
      });
    },
  });
  return infos;
}

export function findNodeInfo(infos: readonly NodeInfo[], name: string): NodeInfo {
  const node = infos.find((candidate) => candidate.name === name);
  expect(node, `expected to find node "${name}"`).toBeDefined();
  if (!node) throw new Error(`unreachable: node "${name}" not found`);
  return node;
}
