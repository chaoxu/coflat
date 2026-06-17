import { parseMarkdownSource } from "../../../core/parser";

export function collectImageTargets(content: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const tree = parseMarkdownSource(content, "html-render");

  tree.iterate({
    enter(node) {
      if (node.type.name !== "Image") return;
      const urlNode = node.node.getChild("URL");
      if (!urlNode) return;

      const src = content.slice(urlNode.from, urlNode.to).trim();
      if (!src || seen.has(src)) return;

      seen.add(src);
      targets.push(src);
    },
  });

  return targets;
}
