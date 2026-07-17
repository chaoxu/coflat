import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { type EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AutocorrectConfig,
  autocorrectExtension,
  handleAutocorrectBackspace,
  handleAutocorrectEnter,
  handleAutocorrectSpace,
  handleQuote,
  handleReplacement,
} from "./autocorrect";
import { createMarkdownLanguageExtensions } from "./base-editor-extensions";
import { createTestView } from "./test-utils";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function createAutocorrectView(
  doc: string,
  options: {
    cursorPos?: number;
    config?: Partial<AutocorrectConfig>;
    extraExtensions?: Extension;
  } = {},
): EditorView {
  const { cursorPos = doc.length, config = {}, extraExtensions = [] } = options;
  view = createTestView(doc, {
    cursorPos,
    extensions: [
      ...createMarkdownLanguageExtensions(),
      autocorrectExtension(config),
      extraExtensions,
    ],
  });
  return view;
}

const insertDoubleQuote = handleQuote('"');
const insertSingleQuote = handleQuote("'");

describe("autocorrect replacements", () => {
  it("replaces -> with an arrow on Space and keeps the space", () => {
    const v = createAutocorrectView("test ->");
    expect(handleAutocorrectSpace(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("test → ");
    expect(v.state.selection.main.head).toBe(v.state.doc.length);
  });

  it("prefers the longest matching key (--- over --)", () => {
    const v = createAutocorrectView("test ---");
    expect(handleAutocorrectSpace(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("test — ");
  });

  it("replaces ... with an ellipsis and != with ≠", () => {
    const v = createAutocorrectView("wait...");
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("wait… ");
    v.destroy();

    const v2 = createAutocorrectView("a !=");
    handleAutocorrectSpace(v2);
    expect(v2.state.doc.toString()).toBe("a ≠ ");
  });

  it("fires on Enter in a plain paragraph", () => {
    const v = createAutocorrectView("test ->");
    expect(handleAutocorrectEnter(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("test →\n");
  });

  it("continues list markup on Enter (no replacement across the marker)", () => {
    // The inserted "\n- " sits between the cursor and the arrow, so the
    // one-position lookbehind cannot match — Zettlr parity.
    const v = createAutocorrectView("- item ->");
    expect(handleAutocorrectEnter(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("- item ->\n- ");
  });

  it("a single Undo reverts only the replacement and keeps the space", () => {
    const v = createAutocorrectView("test ---", { extraExtensions: history() });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("test — ");

    expect(undo(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("test --- ");

    expect(undo(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("test ---");
  });

  it("uses a custom replacement table when provided", () => {
    const v = createAutocorrectView("teh", {
      config: { replacements: [{ key: "teh", value: "the" }] },
    });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("the ");

    // Default table entries are replaced, not merged.
    v.dispatch({
      changes: { from: v.state.doc.length, insert: "->" },
      selection: { anchor: v.state.doc.length + 2 },
    });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("the -> ");
  });

  it("handleReplacement returns false when nothing before the cursor matches", () => {
    const v = createAutocorrectView("plain ");
    expect(handleReplacement(v)).toBe(false);
    expect(v.state.doc.toString()).toBe("plain ");
  });

  it("returns false when disabled so the default space insertion runs", () => {
    const v = createAutocorrectView("test ->", { config: { enabled: false } });
    expect(handleAutocorrectSpace(v)).toBe(false);
    expect(handleAutocorrectEnter(v)).toBe(false);
    expect(v.state.doc.toString()).toBe("test ->");
  });

  it("skips `---` frontmatter delimiter lines on Enter", () => {
    const v = createAutocorrectView("---");
    expect(handleAutocorrectEnter(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("---\n");
  });

  it("replaces at all cursors of a multi-cursor selection", () => {
    const v = createAutocorrectView("a ->\nb ->", {
      cursorPos: 4,
      extraExtensions: EditorState.allowMultipleSelections.of(true),
    });
    v.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(4),
        EditorSelection.cursor(9),
      ]),
    });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("a → \nb → ");
  });
});

describe("magic quotes", () => {
  it("inserts an opening quote at document start and after a space", () => {
    const v = createAutocorrectView("", { cursorPos: 0 });
    expect(insertDoubleQuote(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("“");
    expect(v.state.selection.main.head).toBe(1);
    v.destroy();

    const v2 = createAutocorrectView("word ");
    insertDoubleQuote(v2);
    expect(v2.state.doc.toString()).toBe("word “");
  });

  it("inserts a closing quote after a word character", () => {
    const v = createAutocorrectView("word");
    insertDoubleQuote(v);
    expect(v.state.doc.toString()).toBe("word”");
  });

  it("pairs secondary quotes for the single-quote key", () => {
    const v = createAutocorrectView("say ");
    insertSingleQuote(v);
    expect(v.state.doc.toString()).toBe("say ‘");
    v.dispatch({
      changes: { from: v.state.doc.length, insert: "hi" },
      selection: { anchor: v.state.doc.length + 2 },
    });
    insertSingleQuote(v);
    expect(v.state.doc.toString()).toBe("say ‘hi’");
  });

  it("surrounds a selection with the quote pair and keeps it selected", () => {
    const v = createAutocorrectView("hello", { cursorPos: 0 });
    v.dispatch({ selection: { anchor: 0, head: 5 } });
    insertDoubleQuote(v);
    expect(v.state.doc.toString()).toBe("“hello”");
    expect(v.state.selection.main.from).toBe(1);
    expect(v.state.selection.main.to).toBe(6);
  });

  it("honors the configured quote style (de-DE, fr-FR guillemets)", () => {
    const v = createAutocorrectView("Wort ", {
      config: { quoteStyle: "de-DE" },
    });
    insertDoubleQuote(v);
    expect(v.state.doc.toString()).toBe("Wort „");
    v.destroy();

    const v2 = createAutocorrectView("mot ", {
      config: { quoteStyle: "fr-FR" },
    });
    insertDoubleQuote(v2);
    expect(v2.state.doc.toString()).toBe("mot « ");
  });

  it("returns false when magic quotes are disabled", () => {
    const v = createAutocorrectView("word ", {
      config: { magicQuotes: false },
    });
    expect(insertDoubleQuote(v)).toBe(false);
    expect(v.state.doc.toString()).toBe("word ");
  });
});

describe("backspace downgrade", () => {
  it("downgrades a magic quote to the straight character", () => {
    const v = createAutocorrectView("say “");
    expect(handleAutocorrectBackspace(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('say "');

    // A second Backspace is not consumed (default deletion runs).
    expect(handleAutocorrectBackspace(v)).toBe(false);
    expect(v.state.doc.toString()).toBe('say "');
  });

  it("downgrades closing and secondary quotes too", () => {
    const v = createAutocorrectView("said”");
    handleAutocorrectBackspace(v);
    expect(v.state.doc.toString()).toBe('said"');
    v.destroy();

    const v2 = createAutocorrectView("say ‘");
    handleAutocorrectBackspace(v2);
    expect(v2.state.doc.toString()).toBe("say '");
  });

  it("downgrades multi-character French guillemets in one step", () => {
    const v = createAutocorrectView("mot « ", {
      config: { quoteStyle: "fr-FR" },
    });
    expect(handleAutocorrectBackspace(v)).toBe(true);
    expect(v.state.doc.toString()).toBe('mot "');
  });

  it("returns false for ordinary characters and when disabled", () => {
    const v = createAutocorrectView("plain");
    expect(handleAutocorrectBackspace(v)).toBe(false);
    v.destroy();

    const v2 = createAutocorrectView("say “", { config: { enabled: false } });
    expect(handleAutocorrectBackspace(v2)).toBe(false);
    expect(v2.state.doc.toString()).toBe("say “");
  });
});

describe("protected ranges", () => {
  it("suppresses replacements inside inline code", () => {
    const doc = "`a ->`";
    const v = createAutocorrectView(doc, { cursorPos: doc.length - 1 });
    expect(handleAutocorrectSpace(v)).toBe(true); // space still inserted
    expect(v.state.doc.toString()).toBe("`a -> `");
  });

  it("suppresses replacements inside fenced code", () => {
    const doc = "```\na ->\n```";
    const v = createAutocorrectView(doc, { cursorPos: 8 });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("```\na -> \n```");
  });

  it("suppresses replacements inside math", () => {
    // Cursor after "->" but not adjacent to the closing $ so the math node
    // survives the space insertion.
    const doc = "$a -> b$ x";
    const v = createAutocorrectView(doc, { cursorPos: 5 });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("$a ->  b$ x");
  });

  it("suppresses replacements inside frontmatter but not in the body", () => {
    const doc = "---\ntitle: a ->\n---\nbody ->";
    const v = createAutocorrectView(doc, { cursorPos: 15 });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("---\ntitle: a -> \n---\nbody ->");

    v.dispatch({ selection: { anchor: v.state.doc.length } });
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("---\ntitle: a -> \n---\nbody → ");
  });

  it("does not replace when the match starts inside a protected node", () => {
    // Cursor right after inline code ending in `-`; typed `>` then Space
    // must not join into an arrow across the code boundary.
    const doc = "`a -`>";
    const v = createAutocorrectView(doc);
    handleAutocorrectSpace(v);
    expect(v.state.doc.toString()).toBe("`a -`> ");
  });

  it("inserts straight quotes inside code and math", () => {
    const v = createAutocorrectView("`code`", { cursorPos: 5 });
    insertDoubleQuote(v);
    expect(v.state.doc.toString()).toBe('`code"`');
    v.destroy();

    const v2 = createAutocorrectView("$x$ y", { cursorPos: 2 });
    insertSingleQuote(v2);
    expect(v2.state.doc.toString()).toBe("$x'$ y");
  });

  it("inserts straight quotes inside frontmatter", () => {
    const doc = "---\nt: x\n---\nbody";
    const v = createAutocorrectView(doc, { cursorPos: 8 });
    insertDoubleQuote(v);
    expect(v.state.doc.toString()).toBe('---\nt: x"\n---\nbody');
  });
});

describe("keymap wiring", () => {
  function pressKey(v: EditorView, key: string): boolean {
    return runScopeHandlers(
      v,
      new KeyboardEvent("keydown", { key }),
      "editor",
    );
  }

  it("handles Space, quotes, and Backspace through the bundled keymap", () => {
    const v = createAutocorrectView("test ->");
    expect(pressKey(v, " ")).toBe(true);
    expect(v.state.doc.toString()).toBe("test → ");

    expect(pressKey(v, '"')).toBe(true);
    expect(v.state.doc.toString()).toBe("test → “");

    expect(pressKey(v, "Backspace")).toBe(true);
    expect(v.state.doc.toString()).toBe('test → "');
  });

  it("does not consume keys when disabled", () => {
    const v = createAutocorrectView("test ->", { config: { enabled: false } });
    expect(pressKey(v, " ")).toBe(false);
    expect(pressKey(v, '"')).toBe(false);
    expect(v.state.doc.toString()).toBe("test ->");
  });
});
