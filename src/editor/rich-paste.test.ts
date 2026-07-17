import { afterEach, describe, expect, it, vi } from "vitest";
import { imagePasteExtension } from "./image-paste";
import {
  copySelectionAsHtml,
  copySelectionAsMarkdown,
  createRichPasteCommands,
  htmlCopyRendererFacet,
  htmlIsMeaningfullyRicher,
  htmlToMarkdown,
  pastePlainText,
  richPasteExtension,
} from "./rich-paste";
import { createTestView } from "./test-utils";

// ── Clipboard test helpers ────────────────────────────────────────────────────

interface ClipboardFlavors {
  plain?: string;
  html?: string;
  imageFile?: File;
}

/**
 * Build a synthetic paste event. jsdom's ClipboardEvent has no clipboardData
 * support out of the box — construct a base Event and attach the property
 * (same approach as asset-uploader.test.ts).
 */
function makePasteEvent(flavors: ClipboardFlavors): Event {
  const types: string[] = [];
  if (flavors.imageFile) types.push("Files");
  if (flavors.plain !== undefined) types.push("text/plain");
  if (flavors.html !== undefined) types.push("text/html");
  const imageFile = flavors.imageFile;
  const items = imageFile
    ? [{ type: imageFile.type, getAsFile: () => imageFile }]
    : [];
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      types,
      items,
      getData(type: string) {
        if (type === "text/plain") return flavors.plain ?? "";
        if (type === "text/html") return flavors.html ?? "";
        return "";
      },
    },
  });
  return event;
}

function firePaste(view: ReturnType<typeof createTestView>, flavors: ClipboardFlavors): Event {
  const event = makePasteEvent(flavors);
  view.contentDOM.dispatchEvent(event);
  return event;
}

const clipboardCleanups: Array<() => void> = [];

function stubNavigatorClipboard(clipboard: Partial<Clipboard>): void {
  const hadOwn = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
  clipboardCleanups.push(() => {
    if (hadOwn) {
      Object.defineProperty(navigator, "clipboard", hadOwn);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
}

afterEach(() => {
  while (clipboardCleanups.length) clipboardCleanups.pop()?.();
});

const pngFile = () => new File(["png-bytes"], "shot.png", { type: "image/png" });

async function flush(): Promise<void> {
  // Let the lazy turndown import + conversion microtasks settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

// ── Intent heuristic: htmlIsMeaningfullyRicher ───────────────────────────────

describe("htmlIsMeaningfullyRicher", () => {
  it("is richer when the html carries formatting", () => {
    expect(htmlIsMeaningfullyRicher("<p>a <strong>b</strong></p>", "a b")).toBe(true);
  });

  it("is richer for structural markup (headings, lists, tables)", () => {
    expect(htmlIsMeaningfullyRicher("<h2>Results</h2>", "Results")).toBe(true);
    expect(htmlIsMeaningfullyRicher("<ul><li>x</li></ul>", "x")).toBe(true);
    expect(htmlIsMeaningfullyRicher("<table><tr><td>x</td></tr></table>", "x")).toBe(true);
  });

  it("treats identical flavors as plain (Zettlr's check)", () => {
    expect(htmlIsMeaningfullyRicher("just text", "just text")).toBe(false);
  });

  it("treats style-only wrappers as plain (VS Code / macOS clipboard shape)", () => {
    const html =
      '<meta charset="utf-8"><div style="color:#ccc"><span style="color:#569cd6">const</span> x</div>';
    expect(htmlIsMeaningfullyRicher(html, "const x")).toBe(false);
  });

  it("does not misread longer tag names as rich tags", () => {
    expect(htmlIsMeaningfullyRicher("<abbr title='x'>y</abbr>", "y")).toBe(false);
    expect(htmlIsMeaningfullyRicher("<span>y</span>", "y")).toBe(false);
  });

  it("is not richer when html is empty", () => {
    expect(htmlIsMeaningfullyRicher("", "text")).toBe(false);
    expect(htmlIsMeaningfullyRicher("   ", "text")).toBe(false);
  });
});

// ── Paste heuristic matrix (both extensions mounted) ─────────────────────────

describe("paste heuristic matrix", () => {
  function matrixView(doc = "") {
    return createTestView(doc, {
      extensions: [
        richPasteExtension(),
        imagePasteExtension({ saveImage: async () => "assets/pasted.png" }),
      ],
    });
  }

  it("image-only clipboard goes to the image handler", async () => {
    const view = matrixView();
    const event = firePaste(view, { imageFile: pngFile() });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("![shot](assets/pasted.png)");
    });
  });

  it("text + image clipboard means text intent: no image is inserted", async () => {
    const view = matrixView();
    firePaste(view, { plain: "hello", imageFile: pngFile() });
    await flush();
    expect(view.state.doc.toString()).not.toContain("![");
  });

  it("richer html + text converts the html to markdown", async () => {
    const view = matrixView();
    const event = firePaste(view, {
      plain: "Title\nSome bold text",
      html: "<h1>Title</h1><p>Some <strong>bold</strong> text</p>",
    });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("# Title");
    });
    expect(view.state.doc.toString()).toContain("**bold**");
  });

  it("html that only wraps the plain text is left to the default paste", async () => {
    const view = matrixView();
    firePaste(view, {
      plain: "hello",
      html: '<meta charset="utf-8"><span style="color:red">hello</span>',
    });
    await flush();
    expect(view.state.doc.toString()).not.toContain("#");
    expect(view.state.doc.toString()).not.toContain("**");
  });

  it("falls back to the plain text when conversion yields nothing", async () => {
    const view = matrixView();
    const event = firePaste(view, {
      plain: "fallback text",
      // Rich by the heuristic (contains <img>), but converts to "" because
      // the image has no src or alt.
      html: "<img>",
    });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("fallback text");
    });
  });
});

// ── HTML → Markdown conversion (lazy turndown) ───────────────────────────────

describe("htmlToMarkdown", () => {
  it("converts an Office-ish fixture to Coflat markdown", async () => {
    const officeHtml = [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head>',
      '<meta charset="utf-8"><style>p.MsoNormal { margin: 0 }</style></head><body>',
      '<p class="MsoNormal">Report <b>summary</b> for <i>Q3</i>, <s>draft</s> <mark>final</mark>.</p>',
      "<h2>Results</h2>",
      "<ul><li>First item</li><li>Second item</li></ul>",
      '<table border="1">',
      '<tr><th>Name</th><th align="right">Score</th></tr>',
      "<tr><td>Alice</td><td>97</td></tr>",
      "<tr><td>Bob | Bobby</td><td>88</td></tr>",
      "</table>",
      "<pre><code>let x = 1;</code></pre>",
      "</body></html>",
    ].join("\n");
    const markdown = await htmlToMarkdown(officeHtml);
    expect(markdown).toMatchInlineSnapshot(`
      "Report **summary** for *Q3*, ~~draft~~ ==final==.

      ## Results

      - First item
      - Second item

      | Name | Score |
      | --- | ---: |
      | Alice | 97 |
      | Bob \\| Bobby | 88 |

      \`\`\`
      let x = 1;
      \`\`\`"
    `);
  });

  it("maps <br> in table cells to inline <br> per FORMAT.md", async () => {
    const markdown = await htmlToMarkdown(
      "<table><tr><th>Case</th><th>Notes</th></tr>" +
        "<tr><td>A</td><td>first line<br>second line</td></tr></table>",
    );
    expect(markdown).toContain("| A | first line<br>second line |");
  });

  it("degrades tables with spanning cells instead of emitting broken pipes", async () => {
    const markdown = await htmlToMarkdown(
      '<table><tr><th colspan="2">Wide</th></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    expect(markdown).not.toContain("|");
    expect(markdown).toContain("Wide");
  });

  it("uses Coflat delimiters for emphasis and links", async () => {
    const markdown = await htmlToMarkdown(
      '<p><em>it</em> and <strong>bold</strong> and <a href="https://example.com">link</a></p>',
    );
    expect(markdown).toBe("*it* and **bold** and [link](https://example.com)");
  });
});

// ── Paste as plain text ───────────────────────────────────────────────────────

describe("pastePlainText", () => {
  it("inserts the clipboard text verbatim via the async clipboard API", async () => {
    stubNavigatorClipboard({
      readText: vi.fn().mockResolvedValue("**raw** <b>html</b>"),
    });
    const view = createTestView("", { extensions: [richPasteExtension()] });
    expect(pastePlainText(view)).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("**raw** <b>html</b>");
    });
  });

  it("suppresses html conversion on the next paste when no clipboard API exists", async () => {
    const view = createTestView("", { extensions: [richPasteExtension()] });
    // jsdom has no navigator.clipboard: the command falls through and marks
    // the next paste event as plain-intent.
    expect(pastePlainText(view)).toBe(false);
    const event = firePaste(view, {
      plain: "hello",
      html: "<h1>hello</h1>",
    });
    await flush();
    expect(view.state.doc.toString()).not.toContain("# hello");
    // The plain-intent marker is single-use: a later paste converts again.
    expect(event).toBeDefined();
    const second = firePaste(view, { plain: "hello", html: "<h1>hello</h1>" });
    expect(second.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("# hello");
    });
  });

  it("is bound to Mod-Shift-v in the bundled keymap", async () => {
    stubNavigatorClipboard({
      readText: vi.fn().mockResolvedValue("plain paste"),
    });
    const view = createTestView("", { extensions: [richPasteExtension()] });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe("plain paste");
    });
  });
});

// ── Copy as markdown / html ──────────────────────────────────────────────────

describe("copySelectionAsMarkdown", () => {
  it("writes the selected markdown source as plain text", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigatorClipboard({ writeText });
    const view = createTestView("hello **world**");
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    expect(copySelectionAsMarkdown(view)).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello **world**");
  });

  it("does nothing without a selection", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigatorClipboard({ writeText });
    const view = createTestView("hello");
    expect(copySelectionAsMarkdown(view)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("copySelectionAsHtml", () => {
  class ClipboardItemStub {
    constructor(readonly flavors: Record<string, Blob>) {}
  }

  it("is off (returns false) until a renderer is injected", () => {
    const write = vi.fn().mockResolvedValue(undefined);
    stubNavigatorClipboard({ write });
    const view = createTestView("hello");
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(copySelectionAsHtml(view)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes a dual text/plain + text/html clipboard item", async () => {
    vi.stubGlobal("ClipboardItem", ClipboardItemStub);
    const write = vi.fn().mockResolvedValue(undefined);
    stubNavigatorClipboard({ write });
    const view = createTestView("hello **world**", {
      extensions: [htmlCopyRendererFacet.of((md) => `<p>rendered:${md}</p>`)],
    });
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

    expect(copySelectionAsHtml(view)).toBe(true);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const [items] = write.mock.calls[0] as [ClipboardItemStub[]];
    expect(items).toHaveLength(1);
    const flavors = items[0].flavors;
    expect(await flavors["text/plain"].text()).toBe("hello **world**");
    expect(await flavors["text/html"].text()).toBe("<p>rendered:hello **world**</p>");
  });
});

describe("createRichPasteCommands", () => {
  it("exposes the copy/paste commands with stable ids", () => {
    const ids = createRichPasteCommands().map((command) => command.id);
    expect(ids).toEqual(["copy-as-markdown", "copy-as-html", "paste-as-plain-text"]);
  });

  it("disables copy-as-html while no renderer is injected", () => {
    const view = createTestView("hello");
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    const command = createRichPasteCommands().find((c) => c.id === "copy-as-html");
    expect(command?.isEnabled?.({ view, surface: "palette" })).toBe(false);
  });
});
