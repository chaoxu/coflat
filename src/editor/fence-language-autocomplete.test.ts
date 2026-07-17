import {
  type Completion,
  CompletionContext,
  type CompletionResult,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createMarkdownLanguageExtensions } from "./base-editor-extensions";
import {
  createFenceLanguageCompletionSource,
  fenceLanguageAutocompleteExtension,
  type FenceLanguageInfo,
  findFenceLanguageCompletionMatch,
} from "./fence-language-autocomplete";
import { referenceAutocompleteExtension } from "./reference-autocomplete";
import { ensureFullSyntaxTree } from "./test-utils";

const LANGUAGES: readonly FenceLanguageInfo[] = [
  { name: "javascript", alias: ["js", "jsx"] },
  { name: "python", alias: ["py"] },
  { name: "rust", alias: ["rs"] },
];

function createFenceState(doc: string, cursorPos = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [...createMarkdownLanguageExtensions()],
  });
  ensureFullSyntaxTree(state);
  return state;
}

function completionAt(state: EditorState, pos: number): CompletionResult | null {
  const source = createFenceLanguageCompletionSource(LANGUAGES);
  return source(new CompletionContext(state, pos, true)) as CompletionResult | null;
}

function createFenceView(doc: string, cursorPos = doc.length): {
  view: EditorView;
  parent: HTMLElement;
} {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: createFenceState(doc, cursorPos), parent });
  return { view, parent };
}

function applyOption(
  view: EditorView,
  result: CompletionResult | null,
  label: string,
  from: number,
  to: number,
): void {
  const option = result?.options.find((candidate) => candidate.label === label);
  expect(option).toBeTruthy();
  const apply = option?.apply as (
    view: EditorView,
    completion: Completion,
    from: number,
    to: number,
  ) => void;
  expect(typeof apply).toBe("function");
  apply(view, option as Completion, from, to);
}

describe("findFenceLanguageCompletionMatch", () => {
  it("matches at the end of a bare ``` opener line", () => {
    const state = createFenceState("```");
    expect(findFenceLanguageCompletionMatch(state, 3)).toEqual({ from: 3, query: "" });
  });

  it("captures already-typed characters as the query (dead-key tolerance)", () => {
    const state = createFenceState("```py");
    expect(findFenceLanguageCompletionMatch(state, 5)).toEqual({ from: 3, query: "py" });
  });

  it("does not match when the caret is not at the end of the line", () => {
    const state = createFenceState("```py", 4);
    expect(findFenceLanguageCompletionMatch(state, 4)).toBeNull();
  });

  it("does not match on plain text lines", () => {
    const state = createFenceState("hello");
    expect(findFenceLanguageCompletionMatch(state, 5)).toBeNull();
  });

  it("does not match on the closing fence of a code block", () => {
    const doc = "```js\nconst x = 1\n```";
    const state = createFenceState(doc);
    expect(findFenceLanguageCompletionMatch(state, doc.length)).toBeNull();
  });

  it("does not match on fence-shaped content inside another fence", () => {
    const doc = "~~~\n```\n~~~";
    const state = createFenceState(doc, "~~~\n```".length);
    expect(findFenceLanguageCompletionMatch(state, "~~~\n```".length)).toBeNull();
  });
});

describe("createFenceLanguageCompletionSource", () => {
  it("offers names and aliases at a fence opener", () => {
    const state = createFenceState("```");
    const result = completionAt(state, 3);
    expect(result).not.toBeNull();
    expect(result?.from).toBe(3);
    const labels = result?.options.map((option) => option.label) ?? [];
    expect(labels).toEqual(expect.arrayContaining(["javascript", "python", "py", "rs"]));
    const alias = result?.options.find((option) => option.label === "py");
    expect(alias?.detail).toBe("python");
  });

  it("returns null away from fence openers", () => {
    const state = createFenceState("See text");
    expect(completionAt(state, state.doc.length)).toBeNull();
  });

  it("applies into an unclosed fence by auto-closing it, caret on the blank line", () => {
    const { view, parent } = createFenceView("```");
    const result = completionAt(view.state, 3);
    applyOption(view, result, "python", 3, 3);

    expect(view.state.doc.toString()).toBe("```python\n\n```");
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe("```python\n".length);

    view.destroy();
    parent.remove();
  });

  it("replaces the typed query when applying", () => {
    const { view, parent } = createFenceView("```py");
    const result = completionAt(view.state, 5);
    expect(result?.from).toBe(3);
    applyOption(view, result, "python", 3, 5);

    expect(view.state.doc.toString()).toBe("```python\n\n```");

    view.destroy();
    parent.remove();
  });

  it("closes tilde fences with the full opener run", () => {
    const { view, parent } = createFenceView("~~~~");
    const result = completionAt(view.state, 4);
    applyOption(view, result, "rust", 4, 4);

    expect(view.state.doc.toString()).toBe("~~~~rust\n\n~~~~");
    expect(view.state.selection.main.head).toBe("~~~~rust\n".length);

    view.destroy();
    parent.remove();
  });

  it("does not add a closing fence when the block is already closed", () => {
    const doc = "```\nx\n```";
    const { view, parent } = createFenceView(doc, 3);
    const result = completionAt(view.state, 3);
    applyOption(view, result, "python", 3, 3);

    expect(view.state.doc.toString()).toBe("```python\nx\n```");
    expect(view.state.doc.lines).toBe(3);
    expect(view.state.selection.main.head).toBe("```python".length);

    view.destroy();
    parent.remove();
  });
});

describe("fenceLanguageAutocompleteExtension", () => {
  it("serves fence languages through the shared autocompletion instance", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = EditorState.create({
      doc: "```",
      selection: { anchor: 3 },
      extensions: [
        ...createMarkdownLanguageExtensions(),
        referenceAutocompleteExtension,
        fenceLanguageAutocompleteExtension(LANGUAGES),
      ],
    });
    const view = new EditorView({ state, parent });
    view.focus();

    expect(startCompletion(view)).toBe(true);
    let labels: readonly string[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      labels = currentCompletions(view.state).map((completion) => completion.label);
      if (labels.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(labels).toContain("python");

    view.destroy();
    parent.remove();
  });
});
