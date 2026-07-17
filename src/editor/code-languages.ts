import { LanguageDescription } from "@codemirror/language";

/**
 * Standard code-language descriptions for fenced code blocks.
 *
 * Each language grammar is loaded lazily on first use so `@codemirror/lang-*`
 * packages stay out of the eager editor import graph. Shared between the
 * markdown language config (`editor.ts`) and the fence info-string
 * autocomplete plugin (`editor-plugin-presets.ts`).
 */
const loadJavaScriptLanguage = () => import("@codemirror/lang-javascript");
const loadPythonLanguage = () => import("@codemirror/lang-python");
const loadHtmlLanguage = () => import("@codemirror/lang-html");
const loadCssLanguage = () => import("@codemirror/lang-css");
const loadJsonLanguage = () => import("@codemirror/lang-json");
const loadJavaLanguage = () => import("@codemirror/lang-java");
const loadCppLanguage = () => import("@codemirror/lang-cpp");
const loadRustLanguage = () => import("@codemirror/lang-rust");

export const codeLanguageDescriptions: LanguageDescription[] = [
  LanguageDescription.of({
    name: "javascript",
    alias: ["js", "jsx"],
    load: async () => (await loadJavaScriptLanguage()).javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["ts", "tsx"],
    load: async () =>
      (await loadJavaScriptLanguage()).javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "python",
    alias: ["py"],
    load: async () => (await loadPythonLanguage()).python(),
  }),
  LanguageDescription.of({
    name: "html",
    alias: ["htm"],
    load: async () => (await loadHtmlLanguage()).html(),
  }),
  LanguageDescription.of({
    name: "css",
    alias: ["scss", "less"],
    load: async () => (await loadCssLanguage()).css(),
  }),
  LanguageDescription.of({
    name: "json",
    load: async () => (await loadJsonLanguage()).json(),
  }),
  LanguageDescription.of({
    name: "java",
    load: async () => (await loadJavaLanguage()).java(),
  }),
  LanguageDescription.of({
    name: "cpp",
    alias: ["c", "c++", "cc", "cxx", "h"],
    load: async () => (await loadCppLanguage()).cpp(),
  }),
  LanguageDescription.of({
    name: "rust",
    alias: ["rs"],
    load: async () => (await loadRustLanguage()).rust(),
  }),
];
