import { markdown } from "@codemirror/lang-markdown";
import type { LanguageDescription } from "@codemirror/language";
import { syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { classHighlighter } from "@lezer/highlight";
import type { MarkdownExtension } from "@lezer/markdown";
import { markdownExtensions } from "../core/parser";
import {
  type ProjectConfig,
  type ProjectConfigStatus,
  projectConfigFacet,
  projectConfigStatusFacet,
} from "./project-config";

export { sharedInlineRenderExtensions } from "./render/inline-render-extensions";

// Inline editors use the same semantic Markdown profile as inactive inline
// rendering (`parseInlineFragments`) and the rich editor. Keeping this as an
// alias prevents table cells/block-title editing from drifting when FORMAT
// syntax extensions are added.
export const inlineMarkdownExtensions: readonly MarkdownExtension[] = markdownExtensions;

export function createProjectConfigExtensions(
  projectConfig?: ProjectConfig,
  projectConfigStatus?: ProjectConfigStatus,
): Extension[] {
  const extensions: Extension[] = [];
  if (projectConfig) extensions.push(projectConfigFacet.of(projectConfig));
  if (projectConfigStatus) extensions.push(projectConfigStatusFacet.of(projectConfigStatus));
  return extensions;
}

interface MarkdownLanguageOptions {
  extensions?: readonly MarkdownExtension[];
  codeLanguages?: readonly LanguageDescription[];
  syntaxHighlighting?: boolean;
}

export function createMarkdownLanguageExtensions({
  extensions = markdownExtensions,
  codeLanguages,
  syntaxHighlighting: includeSyntaxHighlighting = false,
}: MarkdownLanguageOptions = {}): Extension[] {
  const languageExtensions: Extension[] = [
    markdown({
      extensions,
      ...(codeLanguages ? { codeLanguages: [...codeLanguages] } : {}),
    }),
  ];

  if (includeSyntaxHighlighting) {
    languageExtensions.push(syntaxHighlighting(classHighlighter));
  }

  return languageExtensions;
}
