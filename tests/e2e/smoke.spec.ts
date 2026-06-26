import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectLoadedSelectorsPixelsMatch,
  expectLoadedSplitContentPixelsMatch,
  loadParityPairSurface,
  loadParitySurface,
  NESTED_MATH_PARITY_SOURCE,
  PARITY_PIXEL_PRESETS,
  setParitySource,
} from "./parity-harness";

const PUBLIC_SHOWCASE_SOURCE = readFileSync(
  join(process.cwd(), "examples/simple/showcase.md"),
  "utf8",
);
const PUBLIC_SHOWCASE_PARITY_SOURCE = PUBLIC_SHOWCASE_SOURCE.replace(
  "(showcase/hover-preview-figure.svg)",
  "(/showcase/hover-preview-figure.svg)",
);
const PUBLIC_SHOWCASE_PARITY_END = (() => {
  const index = PUBLIC_SHOWCASE_PARITY_SOURCE.indexOf("\n# Footnotes");
  if (index < 0) throw new Error("public showcase parity end marker not found");
  return index;
})();
const LINE_HEIGHT_STABILITY_DOC = `# Stable Heading

Plain paragraph with **bold**, \`code\`, $x+1$, and [a link](https://example.com).

::: {.theorem title="Stable block"}
The theorem body has **bold** text and $y^2$.
:::

\`\`\`ts
const value = 1;
console.log(value);
\`\`\`
`;

const IMAGE_CAPTION_PARITY_SOURCE = `# Media Caption

::: {.figure #fig:rich title="Caption with [doc](chapter.md), [@fig:rich], $x^2$, and \`code\`"}
![Figure loading](figures/rich.png)
:::

![Loading alt](relative/figure.png)
`;
const INDENTED_DISPLAY_MATH_PARITY_SOURCE = `# Math List

1. First item
2. Display math in list:
   $$
   T(n) = 2T(n/2) + O(n)
   $$
3. Final item
`;
const INDENTED_DISPLAY_MATH_FINAL_ITEM_FROM =
  INDENTED_DISPLAY_MATH_PARITY_SOURCE.indexOf("3. Final item");
const ROOT_IMAGE_PARITY_SOURCE = `# Root Image

![Local hover-preview figure](/showcase/hover-preview-figure.svg) should render as an inline image without a filesystem.
`;
const BLOCKQUOTE_DISPLAY_MATH_PARITY_SOURCE = `# Blockquote Math

::: Blockquote
Fenced blockquote display math:
$$
x^2 + y^2 = z^2
$$
:::

> Standard blockquote display math:
> $$
> \\int_0^1 x^2\\,dx = \\frac{1}{3}
> $$
`;

async function setEditorDoc(page: Page, doc: string, mode: "rich" | "source" = "rich") {
  await page.evaluate(({ doc, mode }) => {
    const editor = (window as unknown as {
      __coflatEditor: {
        setDoc: (doc: string) => void;
        setMode: (mode: "rich" | "source") => void;
      };
    }).__coflatEditor;
    editor.setDoc(doc);
    editor.setMode(mode as "rich" | "source");
  }, { doc, mode });
}

async function getEditorDoc(page: Page) {
  return page.evaluate(() => {
    return (window as unknown as {
      __coflatEditor: { getDoc: () => string };
    }).__coflatEditor.getDoc();
  });
}

function viewportHeight(page: Page): number {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("missing Playwright viewport");
  return viewport.height;
}

async function expectTooltipWithinViewport(page: Page, tooltip: Locator): Promise<void> {
  const tooltipBox = await tooltip.boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox?.y).toBeGreaterThanOrEqual(0);
  expect((tooltipBox?.y ?? 0) + (tooltipBox?.height ?? 0)).toBeLessThanOrEqual(
    viewportHeight(page),
  );
}

async function scrollThroughUntil(page: Page, yPositions: readonly number[], locator: Locator): Promise<void> {
  const editorScroller = page.locator("#editor .cm-scroller");
  for (const y of yPositions) {
    if (await editorScroller.isVisible().catch(() => false)) {
      await editorScroller.evaluate((el, scrollY) => {
        el.scrollTop = scrollY;
      }, y);
    } else {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
    }
    await page.waitForTimeout(100);
    if (await locator.count() > 0) return;
  }
}

async function scrollDemoEditorTo(page: Page, scrollTop: number): Promise<void> {
  await page.locator("#editor .cm-scroller").evaluate((el, y) => {
    el.scrollTop = y;
  }, scrollTop);
  await page.waitForTimeout(100);
}

async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function settleDemoReaderMath(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const math = Array.from(document.querySelectorAll<HTMLElement>("#reader [data-math]"));
    return math.length > 0 && math.every((element) => element.dataset.mathHydrated === "true");
  });
  await settleLayout(page);
}

function demoHeading(page: Page, surface: "editor" | "reader", text: string): Locator {
  const selector = surface === "reader" ? "#reader .cf-doc-heading" : "#editor .cm-line.cf-doc-heading";
  return page.locator(selector, { hasText: text }).first();
}

async function alignDemoHeadingToViewportRatio(
  page: Page,
  surface: "editor" | "reader",
  text: string,
  viewportRatio: number,
): Promise<void> {
  await page.evaluate(({ surface, text, viewportRatio }) => {
    const scroller = surface === "reader"
      ? document.querySelector<HTMLElement>("#reader-viewport")
      : document.querySelector<HTMLElement>("#editor .cm-scroller");
    const selector = surface === "reader" ? "#reader .cf-doc-heading" : "#editor .cm-line.cf-doc-heading";
    const heading = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .find((element) => element.textContent?.includes(text));
    if (!scroller || !heading) throw new Error(`missing ${surface} heading ${text}`);
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollTop += heading.getBoundingClientRect().top
      - (scrollerRect.top + scrollerRect.height * viewportRatio);
  }, { surface, text, viewportRatio });
  await settleLayout(page);
}

async function demoHeadingTop(page: Page, surface: "editor" | "reader", text: string): Promise<number> {
  const heading = demoHeading(page, surface, text);
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  if (!box) throw new Error(`missing ${surface} heading box for ${text}`);
  return box.y;
}

async function expectLineHeightStableAfterClick(
  page: Page,
  selector: string,
  label: string,
): Promise<void> {
  const line = page.locator(selector);
  await expect(line, label).toHaveCount(1);
  await expect(line, label).toBeVisible();
  const before = await line.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      height: rect.height,
      lineHeight: getComputedStyle(el).lineHeight,
    };
  });

  await line.click({
    position: {
      x: 12,
      y: Math.max(1, Math.min(before.height - 1, before.height / 2)),
    },
  });
  await settleLayout(page);

  const after = await line.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      height: rect.height,
      lineHeight: getComputedStyle(el).lineHeight,
    };
  });
  expect(after.lineHeight, label).toBe(before.lineHeight);
  expect(Math.abs(after.height - before.height), label).toBeLessThanOrEqual(0.5);
}

async function textRect(locator: Locator, text: string) {
  return locator.evaluate((el, targetText) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue ?? "";
      const index = value.indexOf(targetText);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + targetText.length);
        const rect = range.getClientRects()[0];
        if (!rect) throw new Error(`missing text rect for ${targetText}`);
        return {
          left: rect.left,
          top: rect.top,
          height: rect.height,
          width: rect.width,
        };
      }
      node = walker.nextNode();
    }
    throw new Error(`missing text node for ${targetText}`);
  }, text);
}

async function clickLocatorCenter(page: Page, locator: Locator): Promise<void> {
  const coordinates = await locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
  await page.mouse.click(coordinates.x, coordinates.y);
}

async function clickLineOffset(page: Page, locator: Locator, offsetX: number): Promise<void> {
  const coordinates = await locator.evaluate((el, offsetX) => {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(rect.right - 1, Math.max(rect.left + 1, rect.left + offsetX)),
      y: rect.top + rect.height / 2,
    };
  }, offsetX);
  await page.mouse.click(coordinates.x, coordinates.y);
}

interface WrapMetrics {
  readonly height: number;
  readonly lineHeight: number;
  readonly overflowWrap: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly whiteSpace: string;
  readonly wordBreak: string;
}

async function readWrapMetrics(locator: Locator): Promise<WrapMetrics> {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      height: rect.height,
      lineHeight: Number.parseFloat(style.lineHeight),
      overflowWrap: style.overflowWrap,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      whiteSpace: style.whiteSpace,
      wordBreak: style.wordBreak,
    };
  });
}

function expectPreWrapMetrics(metrics: WrapMetrics, label: string): void {
  expect(metrics.whiteSpace, label).toBe("pre");
  expect(metrics.overflowWrap, label).toBe("normal");
  expect(metrics.wordBreak, label).toBe("normal");
  expect(metrics.scrollWidth, label).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.height, label).toBeLessThanOrEqual(metrics.lineHeight + 1);
}

test("editor mounts and accepts input", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");

  const cmEditor = page.locator(".cm-editor");
  await expect(cmEditor).toBeVisible();

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("hello playwright");

  await expect(content).toContainText("hello playwright");
});

test("rich editor cursor movement never changes line height", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, LINE_HEIGHT_STABILITY_DOC, "rich");
  await settleLayout(page);

  for (const [selector, label] of [
    [".cm-line.cf-doc-heading--h1", "heading line"],
    [".cm-line.cf-doc-paragraph:has-text('Plain paragraph')", "paragraph line"],
    [".cm-line.cf-doc-block--theorem.cf-block-header", "theorem header line"],
    [".cm-line.cf-doc-paragraph:has-text('The theorem body')", "theorem body line"],
    [".cm-line.cf-codeblock-header", "code block header line"],
    [".cm-line.cf-codeblock-body:has-text('const value')", "code block body line"],
  ] as const) {
    await expectLineHeightStableAfterClick(page, selector, label);
  }
});

test("rich editor does not reveal heading source while pointer is down", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "# Stable Heading\n\nPlain paragraph.", "rich");
  await settleLayout(page);

  const heading = page.locator(".cm-line.cf-doc-heading--h1");
  await expect(heading).toBeVisible();
  const before = await textRect(heading, "Stable Heading");

  await page.mouse.move(before.left + 4, before.top + before.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(50);

  const during = await textRect(heading, "Stable Heading");
  expect(Math.abs(during.left - before.left)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(0.5);

  await page.mouse.up();
});

test("rich editor rerenders a block header after clicking body text", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await expect(page.locator("#editor .cm-editor")).toBeVisible();
  await scrollDemoEditorTo(page, 1900);
  await settleLayout(page);

  const header = page.locator("#editor .cm-line.cf-block-header", {
    hasText: "Hover Preview Stress Test",
  }).first();
  await expect(header).toContainText("Theorem 1");

  await clickLineOffset(page, header, 140);
  await expect(page.locator("#editor .cm-line.cf-block-source", {
    hasText: "thm:hover-preview",
  })).toBeVisible();

  const body = page.locator("#editor .cm-line", {
    hasText: "This referenced block exists",
  }).first();
  await clickLineOffset(page, body, 200);

  await expect(page.locator("#editor .cm-line.cf-block-source", {
    hasText: "thm:hover-preview",
  })).toHaveCount(0);
  await expect(header).toContainText("Theorem 1");
});

test("rich editor rerenders a code header after clicking code body text", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await expect(page.locator("#editor .cm-editor")).toBeVisible();
  await scrollDemoEditorTo(page, 4050);
  await settleLayout(page);

  const language = page.locator("#editor .cf-codeblock-language", { hasText: "haskell" }).first();
  await expect(language).toBeVisible();
  await clickLocatorCenter(page, language);
  await expect(page.locator("#editor .cm-line.cf-codeblock-source-open", {
    hasText: "```haskell",
  })).toBeVisible();

  const body = page.locator("#editor .cm-line", {
    hasText: "fibonacci :: Int -> Int",
  }).first();
  await clickLineOffset(page, body, 160);

  await expect(page.locator("#editor .cm-line.cf-codeblock-source-open", {
    hasText: "```haskell",
  })).toHaveCount(0);
  await expect(page.locator("#editor .cf-codeblock-language", { hasText: "haskell" })).toBeVisible();
});

test("rich editor keeps task-list point clicks on the clicked row", async ({ page }) => {
  const labels = [
    "Inline rendering surfaces",
    "Explicit structure editing",
    "Stable shell overlay",
    "browser-level regression",
  ];

  for (let rowIndex = 0; rowIndex < labels.length; rowIndex += 1) {
    await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
    await expect(page.locator("#editor .cm-editor")).toBeVisible();
    await scrollDemoEditorTo(page, 3589);
    await settleLayout(page);

    const line = page.locator(".cm-line", { hasText: labels[rowIndex] });
    await expect(line).toHaveCount(1);
    const point = await line.evaluate((el) => {
      const input = el.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLElement)) {
        throw new Error("missing task checkbox");
      }
      const lineRect = el.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      return {
        x: inputRect.right + 45,
        y: lineRect.top + lineRect.height / 2,
      };
    });

    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Z");

    const taskRows = await page.locator('.cm-line:has(input[type="checkbox"])').evaluateAll((rows) =>
      rows.map((row) => row.textContent ?? "")
    );
    expect(taskRows[rowIndex], labels[rowIndex]).toContain("Z");
    for (let i = 0; i < taskRows.length; i += 1) {
      if (i !== rowIndex && labels.some((label) => taskRows[i]?.includes(label))) {
        expect(taskRows[i], `${labels[rowIndex]} did not edit task row ${i + 1}`).not.toContain("Z");
      }
    }
  }
});

test("public demo point clicks stay on representative rendered rows", async ({ page }) => {
  const cases = [
    {
      name: "paragraph",
      scrollY: 0,
      text: "canonical single-page Coflat showcase",
      expected: "exZercises the editor",
    },
    {
      name: "heading",
      scrollY: 0,
      text: "Frontmatter and Structure Editing",
      expected: "FrontZmatter and Structure Editing",
    },
    {
      name: "ordinary list",
      scrollY: 0,
      text: "ordinary navigation should keep",
      expected: "ordinary nZavigation",
    },
    {
      name: "task list",
      scrollY: 3589,
      text: "Inline rendering surfaces",
      expected: "InlineZ rendering surfaces",
    },
    {
      name: "code header",
      scrollY: 4050,
      text: "haskell",
      expected: "haskellZ",
    },
    {
      name: "code body",
      scrollY: 4050,
      text: "fibonacci :: Int -> Int",
      expected: "fibonaccZi :: Int",
    },
  ] as const;

  for (const item of cases) {
    await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
    await expect(page.locator("#editor .cm-editor")).toBeVisible();
    await scrollDemoEditorTo(page, item.scrollY);
    await settleLayout(page);

    const line = page.locator(".cm-line", { hasText: item.text }).first();
    await expect(line, item.name).toBeVisible();
    const point = await line.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const input = el.querySelector('input[type="checkbox"]');
      const x = input instanceof HTMLElement
        ? input.getBoundingClientRect().right + 45
        : rect.left + 80;
      return {
        x: Math.min(rect.right - 8, x),
        y: rect.top + rect.height / 2,
      };
    });

    await page.mouse.click(point.x, point.y);
    await page.keyboard.type("Z");

    await expect(page.locator(".cm-line", { hasText: item.expected }).first(), item.name).toBeVisible();
  }
});

test("editor supports ordinary list exit and marker removal while writing", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "- item", "source");

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Meta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After list");
  await expect.poll(() => getEditorDoc(page)).toBe("- item\n\nAfter list");

  await setEditorDoc(page, "- one\n- two", "source");
  await page.evaluate(() => {
    const editor = (window as unknown as {
      __coflatEditor: { focus: () => void; scrollToPosition: (from: number) => void };
    }).__coflatEditor;
    editor.scrollToPosition("- one\n- ".length);
    editor.focus();
  });
  await page.keyboard.press("Backspace");
  await expect.poll(() => getEditorDoc(page)).toBe("- one\ntwo");
});

test("rich editor supports ordinary fenced code and display math writing", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "", "rich");

  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const y = 2;");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");

  await expect.poll(() => getEditorDoc(page)).toBe("```js\nconst y = 2;\n```\nafter");

  await setEditorDoc(page, "", "rich");
  await content.click();
  await page.keyboard.type("$$");
  await page.keyboard.type("x=1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("after");

  await expect.poll(() => getEditorDoc(page)).toBe("$$\nx=1\n$$\nafter");
});

test("rich editor keeps a usable writing column on narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, "# A long heading that should not collapse into a tiny strip", "rich");

  const lineWidth = await page.locator(".cm-line").first().evaluate((el) =>
    Math.round(el.getBoundingClientRect().width)
  );
  expect(lineWidth).toBeGreaterThan(240);
});

test("public demo uses a real editor viewport instead of page-level virtualized scrolling", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  const scroller = page.locator("#editor > .cm-editor > .cm-scroller");
  await expect(scroller).toBeVisible();

  const scrollStyles = await scroller.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      clientHeight: el.clientHeight,
      overflowY: style.overflowY,
      overscrollBehaviorY: style.overscrollBehaviorY,
      scrollHeight: el.scrollHeight,
      windowScrollHeight: document.documentElement.scrollHeight,
      windowHeight: window.innerHeight,
    };
  });
  expect(scrollStyles.overflowY).toBe("auto");
  expect(scrollStyles.overscrollBehaviorY).toBe("contain");
  expect(scrollStyles.scrollHeight).toBeGreaterThan(scrollStyles.clientHeight);
  expect(scrollStyles.windowScrollHeight).toBe(scrollStyles.windowHeight);

  const box = await scroller.boundingBox();
  if (!box) {
    throw new Error("Missing public demo editor scroller");
  }

  await page.mouse.move(
    box.x + Math.min(40, box.width / 2),
    box.y + Math.min(300, box.height / 2),
  );
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 700);
  }

  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect
    .poll(() => page.evaluate(() => document.body.innerText.includes("This footnote has bold")))
    .toBe(true);
});

test("public demo sidebar switches to the format guide", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  await expect(page.getByRole("link", { name: "Showcase" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Format guide" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("button", { name: "Readonly" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reader" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FORMAT.md" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Reader API" })).toBeVisible();

  await page.getByRole("link", { name: "Format guide" }).click();

  await expect(page).toHaveURL(/doc=format/);
  await expect(page).toHaveTitle("Coflat Format Guide");
  await expect(page.getByRole("link", { name: "Format guide" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".cm-content")).toContainText("Coflat Document Format");
  await expect(page.locator(".cm-content")).toContainText("pandoc-crossref");

  await page.getByRole("link", { name: "Showcase" }).click();
  await expect(page).toHaveURL(/doc=showcase/);
  await expect(page).toHaveTitle("Coflat Editor Showcase");
  await expect(page.locator(".cm-content")).toContainText("Coflat Feature Showcase");
});

test("public demo readonly surface uses CM6 rich rendering without editing", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=readonly");

  const editor = page.locator("#editor");
  const content = editor.locator(".cm-content");
  await expect(editor).toBeVisible();
  await expect(page.locator("#reader")).toBeHidden();
  await expect(page.getByRole("button", { name: "Readonly" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect(content).toContainText("Coflat Feature Showcase");

  const tableCell = page.locator("#editor .cf-table-widget td", {
    hasText: "Edit this cell",
  }).first();
  await scrollThroughUntil(page, [2500, 3000, 3500, 4000, 4500], tableCell);
  await tableCell.scrollIntoViewIfNeeded();
  await tableCell.click();
  await expect(page.locator("#editor .cf-table-cell-editing")).toHaveCount(0);
  await expect(tableCell.locator(".cm-editor")).toHaveCount(0);
  await expect(content).toHaveAttribute("contenteditable", "false");

  await content.click();
  await page.keyboard.type("not inserted");
  await expect(editor).not.toContainText("not inserted");

  await page.getByRole("button", { name: "Editor" }).click();
  await expect(page).toHaveURL(/surface=editor/);
  await expect(content).toHaveAttribute("contenteditable", "true");
});

test("public demo surface switch preserves the visible document position", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await settleLayout(page);

  await scrollThroughUntil(page, [800, 1000, 1200, 1400, 1600, 1800], demoHeading(page, "editor", "Math in Lists"));
  await alignDemoHeadingToViewportRatio(page, "editor", "Math in Lists", 0.2);
  const editorTop = await demoHeadingTop(page, "editor", "Math in Lists");

  await page.getByRole("button", { name: "Reader" }).click();
  await expect(page).toHaveURL(/surface=reader/);
  await settleDemoReaderMath(page);
  await expect
    .poll(async () => Math.abs(await demoHeadingTop(page, "reader", "Math in Lists") - editorTop))
    .toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Readonly" }).click();
  await expect(page).toHaveURL(/surface=readonly/);
  await settleLayout(page);
  await expect(demoHeading(page, "editor", "Math in Lists")).not.toContainText("# Math in Lists");
  await expect
    .poll(async () => Math.abs(await demoHeadingTop(page, "editor", "Math in Lists") - editorTop))
    .toBeLessThanOrEqual(2);

  await scrollThroughUntil(page, [2200, 2400, 2600, 2800, 3000, 3200], demoHeading(page, "editor", "Tables"));
  await alignDemoHeadingToViewportRatio(page, "editor", "Tables", 0.2);
  const readonlyTop = await demoHeadingTop(page, "editor", "Tables");

  await page.getByRole("button", { name: "Reader" }).click();
  await expect(page).toHaveURL(/surface=reader/);
  await settleDemoReaderMath(page);
  await expect
    .poll(async () => Math.abs(await demoHeadingTop(page, "reader", "Tables") - readonlyTop))
    .toBeLessThanOrEqual(2);
});

test("public demo reveals reader only after math is hydrated", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await settleLayout(page);
  await page.evaluate(() => {
    const state = window as unknown as { __coflatRawReaderMathVisible?: boolean };
    state.__coflatRawReaderMathVisible = false;
    const detectVisibleRawMath = () => {
      const viewport = document.querySelector<HTMLElement>("#reader-viewport");
      const reader = document.querySelector<HTMLElement>("#reader");
      if (!viewport || !reader || viewport.hidden) return;
      if (reader.querySelector('[data-math]:not([data-math-hydrated="true"])')) {
        state.__coflatRawReaderMathVisible = true;
      }
    };
    const observer = new MutationObserver(() => {
      detectVisibleRawMath();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["hidden", "data-math-hydrated"],
      childList: true,
      subtree: true,
    });
    const sampleVisibleFrames = () => {
      detectVisibleRawMath();
      requestAnimationFrame(sampleVisibleFrames);
    };
    requestAnimationFrame(sampleVisibleFrames);
  });

  await page.getByRole("button", { name: "Reader" }).click();
  await settleDemoReaderMath(page);
  await expect(page.locator("#reader-viewport")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() =>
      Boolean((window as unknown as { __coflatRawReaderMathVisible?: boolean }).__coflatRawReaderMathVisible)
    ))
    .toBe(false);

  await page.getByRole("button", { name: "Readonly" }).click();
  await expect(page.locator("#editor")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __coflatRawReaderMathVisible?: boolean }).__coflatRawReaderMathVisible = false;
  });
  await page.getByRole("button", { name: "Reader" }).click();
  await settleDemoReaderMath(page);
  await expect(page.locator("#reader-viewport")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() =>
      Boolean((window as unknown as { __coflatRawReaderMathVisible?: boolean }).__coflatRawReaderMathVisible)
    ))
    .toBe(false);

  const cachedReaderBlock = page.locator('#reader [id="thm:hover-preview"]');
  await cachedReaderBlock.scrollIntoViewIfNeeded();
  const cachedReaderBlockButton = cachedReaderBlock.locator("> .cf-doc-block-heading > .cf-block-disclosure-toggle");
  await expect(cachedReaderBlockButton).toHaveAttribute("aria-expanded", "true");
  await cachedReaderBlockButton.click({ force: true });
  await expect(cachedReaderBlockButton).toHaveAttribute("aria-expanded", "false");
  expect(await cachedReaderBlock.evaluate((block) => {
    const body = block.querySelector(":scope > .cf-block-disclosure-body");
    return {
      expanded: block.getAttribute("data-cf-block-open"),
      hidden: body instanceof HTMLElement ? body.hidden : null,
    };
  })).toEqual({
    expanded: "false",
    hidden: true,
  });
});

test("public demo reader surface shows shared hover previews", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=format&surface=reader");

  const reader = page.locator("#reader");
  await expect(reader).toBeVisible();
  await expect(reader).toContainText("Coflat Document Format");
  await expect(page.locator("#editor")).toBeHidden();
  await expect(page.getByRole("button", { name: "Reader" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const equationReference = reader.locator('[data-ref-key="eq:format-live"]').first();
  await expect(equationReference).toBeVisible();
  await equationReference.hover();

  const tooltip = page.locator('.cf-hover-preview-tooltip[data-visible="true"]');
  await expect(tooltip).toContainText("E = mc^2");
  await expectTooltipWithinViewport(page, tooltip);
});

test("public format guide keeps reader and editor code block wrapping aligned", async ({ page }) => {
  for (const viewportWidth of [1280, 390]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });

    await page.goto("/examples/simple/index.html?doc=format&surface=reader");
    const readerCode = page.locator("#reader .cf-doc-code-block code", {
      hasText: "markdown+fenced_divs",
    }).first();
    await expect(readerCode).toBeVisible();
    expectPreWrapMetrics(
      await readWrapMetrics(readerCode),
      `reader code block at ${viewportWidth}px`,
    );

    await page.goto("/examples/simple/index.html?doc=format&surface=editor");
    await expect(page.locator("#editor .cm-editor")).toBeVisible();
    const editorCode = page.locator("#editor .cm-line.cf-codeblock-last", {
      hasText: "markdown+fenced_divs",
    }).first();
    await expect(editorCode).toBeVisible();
    expectPreWrapMetrics(
      await readWrapMetrics(editorCode),
      `editor code block last row at ${viewportWidth}px`,
    );
  }
});

test("rich editor keeps all rendered code block row types unwrapped", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/tests/e2e/fixtures/index.html");
  await setEditorDoc(page, [
    "```verylonglanguageidentifierabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
    "const middle = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
    "const last = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';",
    "```",
  ].join("\n"), "rich");
  await settleLayout(page);

  for (const [selector, label] of [
    [".cm-line.cf-codeblock-header", "header row"],
    [".cm-line.cf-codeblock-body", "middle row"],
    [".cm-line.cf-codeblock-last", "last row"],
  ] as const) {
    const row = page.locator(selector).first();
    await expect(row, label).toBeVisible();
    expectPreWrapMetrics(await readWrapMetrics(row), label);
  }
});

test("public demo reader resolves showcase local images", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");

  const image = page.locator('#reader img.cf-image[alt="Local hover-preview figure"]');
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img) => ({
      height: (img as HTMLImageElement).naturalHeight,
      width: (img as HTMLImageElement).naturalWidth,
    })))
    .toEqual({ height: 150, width: 257 });
  await expect(image).toHaveAttribute("src", /\/showcase\/hover-preview-figure\.svg$/);
});

test("public demo reader block hover previews are inert", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 826 });
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");

  const blockReference = page.locator('#reader [data-ref-key="thm:hover-preview"]').first();
  await scrollThroughUntil(page, [1500, 1800, 2000, 2200, 2400], blockReference);
  await expect(blockReference).toBeVisible();

  await blockReference.hover();

  const tooltip = page.locator('.cf-hover-preview-tooltip[data-visible="true"]');
  await expect(tooltip).toContainText("Theorem 1");
  await expect(tooltip).toContainText("This referenced block exists");
  await expect(tooltip.locator(".cf-block-disclosure-toggle")).toHaveCount(0);
  await expect(tooltip.locator(".cf-doc-block-collapsible")).toHaveCount(0);
  const previewList = tooltip.locator(".cf-doc-list--unordered").first();
  const previewListItem = tooltip.locator(".cf-doc-list-item").first();
  await expect(previewList).toHaveCSS("list-style-type", "none");
  await expect(previewList).toHaveCSS("padding-left", "0px");
  await expect(previewListItem).toHaveCSS("display", "block");
  await expectTooltipWithinViewport(page, tooltip);
});

test("public demo reader resolves internal references without broken math", async ({ page }) => {
  for (const doc of ["showcase", "format"] as const) {
    await page.goto(`/examples/simple/index.html?doc=${doc}&surface=reader`);
    await expect(page.locator("#reader")).toBeVisible();
    await expect(page.locator("#reader .cf-math-error, #reader .katex-error")).toHaveCount(0);
    await expect(
      page.locator("#reader .cf-crossref-unresolved, #reader .cf-citation-unresolved"),
    ).toHaveCount(0);
  }
});

test("public demo reader aligns the collapse rail with the disclosure triangle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");

  const theorem = page.locator("#reader #thm\\:hover-preview");
  await expect(theorem).toBeVisible();
  await theorem.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);

  const beforeHover = await theorem.evaluate((el) => {
    const headingText = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-heading-content");
    const toggle = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-disclosure-toggle");
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    const bodyParagraph = el.querySelector(":scope > .cf-block-disclosure-body .cf-doc-paragraph");
    if (!(headingText instanceof HTMLElement) || !(toggle instanceof HTMLElement) || !(body instanceof HTMLElement) || !(bodyParagraph instanceof HTMLElement)) {
      throw new Error("missing theorem disclosure parts");
    }
    const blockRect = el.getBoundingClientRect();
    const headingRect = headingText.getBoundingClientRect();
    const textRect = headingText.getBoundingClientRect();
    const toggleRect = toggle.getBoundingClientRect();
    const bodyWrapperRect = body.getBoundingClientRect();
    const bodyRect = bodyParagraph.getBoundingClientRect();
    const railStyle = getComputedStyle(body, "::before");
    const railCenter = bodyWrapperRect.left + Number.parseFloat(railStyle.left);
    const railTop = bodyWrapperRect.top + Number.parseFloat(railStyle.top);
    const toggleCenter = (toggleRect.left + toggleRect.right) / 2;
    return {
      bodyTextLeft: bodyRect.left,
      blockHeight: blockRect.height,
      blockWidth: blockRect.width,
      headingBottom: headingRect.bottom,
      headingTextLeft: textRect.left,
      railCenter,
      railOpacity: railStyle.opacity,
      railTop,
      toggleCenter,
      toggleOpacity: getComputedStyle(toggle).opacity,
      toggleTextGap: textRect.left - toggleRect.right,
    };
  });
  expect(beforeHover.railOpacity).toBe("0");
  expect(beforeHover.toggleOpacity).toBe("0");
  expect(Math.abs(beforeHover.toggleTextGap - 4)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(beforeHover.headingTextLeft - beforeHover.bodyTextLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(beforeHover.railCenter - beforeHover.toggleCenter)).toBeLessThanOrEqual(0.75);
  expect(beforeHover.railTop).toBeGreaterThanOrEqual(beforeHover.headingBottom - 0.5);

  await theorem.hover();
  await expect.poll(() => theorem.evaluate((el) => {
    const toggle = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-disclosure-toggle");
    if (!(toggle instanceof HTMLElement)) throw new Error("missing disclosure toggle");
    return getComputedStyle(toggle).opacity;
  })).toBe("1");
  expect(await theorem.evaluate((el) => {
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing disclosure body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("0");

  const theoremToggle = theorem.locator("> .cf-doc-block-heading > .cf-block-disclosure-toggle");
  await theoremToggle.hover();
  await expect.poll(() => theorem.evaluate((el) => {
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing disclosure body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("1");
  const afterHover = await theorem.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing disclosure body");
    return {
      blockHeight: rect.height,
      blockWidth: rect.width,
      railOpacity: getComputedStyle(body, "::before").opacity,
    };
  });
  expect(afterHover.railOpacity).toBe("1");
  expect(Math.abs(afterHover.blockHeight - beforeHover.blockHeight)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(afterHover.blockWidth - beforeHover.blockWidth)).toBeLessThanOrEqual(0.5);
});

test("public demo editor shows matching collapse rails", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await expect(page.locator("#editor .cm-editor")).toBeVisible();
  await settleLayout(page);

  const numberedHeading = page.locator('#editor .cm-line.cf-doc-heading--h1[data-section-number="2"]');
  await numberedHeading.scrollIntoViewIfNeeded();
  const headingBeforeHover = await numberedHeading.evaluate((heading) => {
    const rect = heading.getBoundingClientRect();
    return {
      beforeContent: getComputedStyle(heading, "::before").content,
      height: rect.height,
      text: heading.textContent,
      width: rect.width,
    };
  });
  await numberedHeading.hover();
  await expect.poll(() => numberedHeading.locator(".cf-fold-toggle").evaluate((toggle) =>
    getComputedStyle(toggle).opacity
  )).toBe("1");
  await expect(page.locator('#editor .cf-fold-rail-overlay[data-cf-visible="true"]')).toHaveCount(0);
  const headingAfterHover = await numberedHeading.evaluate((heading) => {
    const rect = heading.getBoundingClientRect();
    return {
      beforeContent: getComputedStyle(heading, "::before").content,
      height: rect.height,
      text: heading.textContent,
      width: rect.width,
    };
  });
  expect(headingAfterHover).toEqual(headingBeforeHover);

  await scrollDemoEditorTo(page, 1950);
  await settleLayout(page);
  await page.mouse.move(10, 10);

  await expect.poll(() => page.locator("#editor .cf-fold-block").count()).toBeGreaterThan(0);
  await expect(page.locator('#editor .cf-fold-rail-overlay[data-cf-visible="true"]')).toHaveCount(0);

  const blockHeader = page.locator("#editor .cm-line.cf-fold-line", { hasText: "Hover Preview Stress Test" });
  await expect(blockHeader).toBeVisible();
  await blockHeader.hover();
  await expect.poll(() => blockHeader.locator(".cf-fold-toggle").evaluate((toggle) =>
    getComputedStyle(toggle).opacity
  )).toBe("1");
  await expect(page.locator('#editor .cf-fold-rail-overlay[data-cf-visible="true"]')).toHaveCount(0);

  const blockToggle = blockHeader.locator(".cf-fold-block");
  await expect(blockToggle).toBeVisible();
  await blockToggle.hover();
  await expect.poll(() => page.locator("#editor .cf-fold-rail-line-block").count()).toBeGreaterThan(0);
  await expect(page.locator("#editor .cf-fold-line.cf-fold-rail-line")).toHaveCount(0);
  await expect.poll(() =>
    page.locator("#editor .cf-fold-rail-heading-active .cf-fold-toggle").evaluate((el) =>
      getComputedStyle(el).opacity
    )
  ).toBe("1");

  const railGeometry = await page.evaluate(() => {
    const toggle = document.querySelector("#editor .cf-fold-rail-heading-active .cf-fold-toggle");
    const overlay = document.querySelector('#editor .cf-fold-rail-overlay[data-cf-visible="true"]');
    const activeHeading = document.querySelector("#editor .cf-fold-rail-heading-active");
    const displayMath = [...document.querySelectorAll("#editor .cf-doc-display-math")].find((el) => {
      if (!(activeHeading instanceof HTMLElement)) return false;
      const headingRect = activeHeading.getBoundingClientRect();
      const mathRect = el.getBoundingClientRect();
      return mathRect.top > headingRect.bottom && mathRect.top < headingRect.bottom + 220;
    });
    if (!(toggle instanceof HTMLElement) || !(overlay instanceof HTMLElement) || !(activeHeading instanceof HTMLElement) || !(displayMath instanceof HTMLElement)) {
      throw new Error("missing editor rail parts");
    }
    const toggleRect = toggle.getBoundingClientRect();
    const headingRect = activeHeading.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const mathRect = displayMath.getBoundingClientRect();
    return {
      displayMathBottom: mathRect.bottom,
      displayMathTop: mathRect.top,
      headerBottom: headingRect.bottom,
      overlayBackground: getComputedStyle(overlay).backgroundColor,
      overlayBottom: overlayRect.bottom,
      overlayCenter: (overlayRect.left + overlayRect.right) / 2,
      overlayTop: overlayRect.top,
      overlayWidth: getComputedStyle(overlay).width,
      toggleCenter: (toggleRect.left + toggleRect.right) / 2,
      toggleOpacity: getComputedStyle(toggle).opacity,
    };
  });
  expect(railGeometry.overlayBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(railGeometry.overlayWidth).toBe("2px");
  expect(railGeometry.overlayTop).toBeGreaterThanOrEqual(railGeometry.headerBottom - 0.5);
  expect(railGeometry.overlayTop).toBeLessThanOrEqual(railGeometry.headerBottom + 0.5);
  expect(railGeometry.overlayTop).toBeLessThanOrEqual(railGeometry.displayMathTop + 0.5);
  expect(railGeometry.overlayBottom).toBeGreaterThanOrEqual(railGeometry.displayMathBottom - 0.5);
  expect(Math.abs(railGeometry.overlayCenter - railGeometry.toggleCenter)).toBeLessThanOrEqual(0.75);
  expect(railGeometry.toggleOpacity).toBe("1");

  await page.mouse.move(10, 10);
  await expect(page.locator('#editor .cf-fold-rail-overlay[data-cf-visible="true"]')).toHaveCount(0);
});

test("public demo reader shows only the deepest nested disclosure rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");

  const theorem = page.locator("#reader #thm\\:hover-preview");
  await expect(theorem).toBeVisible();
  await theorem.scrollIntoViewIfNeeded();
  await page.mouse.move(10, 10);

  await theorem.hover();
  expect(await theorem.evaluate((block) => {
    const body = block.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing theorem body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("0");

  const theoremToggle = theorem.locator("> .cf-doc-block-heading > .cf-block-disclosure-toggle");
  await theoremToggle.hover();
  await expect.poll(() => theorem.evaluate((block) => {
    const body = block.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing theorem body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("1");
  await expect.poll(() => theorem.evaluate((block) => {
    const sectionBody = block.closest(".cf-section-disclosure-body");
    if (!(sectionBody instanceof HTMLElement)) throw new Error("missing containing section body");
    return getComputedStyle(sectionBody, "::before").opacity;
  })).toBe("0");

  const sectionToggle = page.locator('#reader .cf-doc-section-heading-collapsible:has-text("Block Hover Preview Coverage") > .cf-section-disclosure-toggle');
  await expect(sectionToggle).toHaveCount(1);
  await sectionToggle.hover();
  await expect.poll(() => page.locator('#reader .cf-doc-section-heading-collapsible:has-text("Block Hover Preview Coverage")').evaluate((heading) => {
    const body = heading.nextElementSibling;
    if (!(body instanceof HTMLElement)) throw new Error("missing section body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("1");
  await expect.poll(() => theorem.evaluate((block) => {
    const body = block.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing theorem body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("0");
});

test("public demo exposes matching section and block disclosure controls", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");
  await expect(page.locator("#reader")).toBeVisible();

  expect(await page.locator("#reader .cf-section-disclosure-toggle").count()).toBeGreaterThan(0);
  expect(await page.locator("#reader .cf-doc-block-collapsible > .cf-doc-block-heading > .cf-block-disclosure-toggle").count()).toBeGreaterThan(0);

  const readerSectionButton = page.locator("#reader .cf-doc-section-heading-collapsible > .cf-section-disclosure-toggle").first();
  await readerSectionButton.click({ force: true });
  expect(await page.locator("#reader .cf-doc-section-heading-collapsible").first().evaluate((heading) => {
    const body = heading.nextElementSibling;
    return {
      expanded: heading.getAttribute("data-cf-section-open"),
      hidden: body instanceof HTMLElement ? body.hidden : null,
      ariaExpanded: heading.querySelector(".cf-section-disclosure-toggle")?.getAttribute("aria-expanded"),
    };
  })).toEqual({
    expanded: "false",
    hidden: true,
    ariaExpanded: "false",
  });

  const readerBlockButton = page.locator('#reader [id="thm:hover-preview"] > .cf-doc-block-heading > .cf-block-disclosure-toggle');
  await expect(readerBlockButton).toHaveCSS("font-style", "normal");
  await readerBlockButton.click({ force: true });
  await expect(readerBlockButton).toHaveCSS("font-style", "normal");
  expect(await page.locator('#reader [id="thm:hover-preview"]').evaluate((block) => {
    const body = block.querySelector(":scope > .cf-block-disclosure-body");
    return {
      expanded: block.getAttribute("data-cf-block-open"),
      hidden: body instanceof HTMLElement ? body.hidden : null,
      ariaExpanded: block.querySelector(":scope > .cf-doc-block-heading > .cf-block-disclosure-toggle")?.getAttribute("aria-expanded"),
    };
  })).toEqual({
    expanded: "false",
    hidden: true,
    ariaExpanded: "false",
  });

  await page.goto("/examples/simple/index.html?doc=showcase&surface=editor");
  await expect(page.locator("#editor .cm-editor")).toBeVisible();
  await settleLayout(page);
  await scrollDemoEditorTo(page, 2400);
  await settleLayout(page);

  await expect.poll(() => page.locator("#editor .cf-fold-block").count()).toBeGreaterThan(0);
  const editorBlockButton = page.locator("#editor .cf-fold-block").first();
  await expect(editorBlockButton).toHaveAttribute("aria-label", "Fold block");
  await expect(editorBlockButton).toHaveCSS("font-style", "normal");
  await editorBlockButton.click({ force: true });
  await expect(editorBlockButton).toHaveAttribute("aria-label", "Unfold block");
  await expect(editorBlockButton).toHaveCSS("font-style", "normal");

  const editorSectionButton = page.locator('#editor .cm-line.cf-fold-line:has-text("Block Hover Preview Coverage") .cf-fold-h1');
  await expect(editorSectionButton).toHaveCount(1);
  await expect(editorSectionButton).toHaveAttribute("aria-label", "Fold section");
  await editorSectionButton.click({ force: true });
  await expect(editorSectionButton).toHaveAttribute("aria-label", "Unfold section");
});

test("public demo keeps reader disclosure controls inside zero-padding embeds", async ({ page }) => {
  await page.goto("/examples/simple/index.html?doc=showcase&surface=reader");
  const reader = page.locator("#reader");
  await expect(reader).toBeVisible();

  await reader.evaluate((el) => {
    (el as HTMLElement).style.setProperty("--cf-doc-content-padding-inline", "0px");
  });
  await settleLayout(page);

  const geometry = await page.locator("#reader .cf-doc-section-heading-collapsible").first().evaluate((heading) => {
    const readerRoot = heading.closest("#reader");
    const toggle = heading.querySelector(":scope > .cf-section-disclosure-toggle");
    if (!(readerRoot instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
      throw new Error("missing reader section disclosure geometry");
    }
    const readerBox = readerRoot.getBoundingClientRect();
    const toggleBox = toggle.getBoundingClientRect();
    return {
      paddingInlineStart: getComputedStyle(readerRoot).paddingInlineStart,
      readerLeft: readerBox.left,
      toggleLeft: toggleBox.left,
      toggleRight: toggleBox.right,
    };
  });

  expect(Number.parseFloat(geometry.paddingInlineStart)).toBeGreaterThan(0);
  expect(geometry.toggleLeft).toBeGreaterThanOrEqual(geometry.readerLeft - 0.5);
  expect(geometry.toggleRight).toBeGreaterThan(geometry.toggleLeft);
});

test("public demo table cell editing does not inherit page-height scrolling", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  await scrollThroughUntil(page, [2500, 3000, 3500, 4000, 4500], page.locator(".cf-table-widget td").nth(16));

  const cell = page.getByRole("cell", { name: /Edit this cell/ });
  await expect(cell).toContainText("Edit this cell");
  await cell.scrollIntoViewIfNeeded();

  const before = await cell.evaluate((el) => ({
    cellHeight: el.getBoundingClientRect().height,
    rowHeight: el.closest("tr")?.getBoundingClientRect().height ?? 0,
  }));

  await cell.dblclick();
  const activeCell = page.locator(".cf-table-cell-editing");
  await expect(activeCell).toBeVisible();

  const after = await activeCell.evaluate((el) => {
    const editor = el.querySelector(".cm-editor");
    const scroller = el.querySelector(".cm-scroller");
    const editorStyle = editor ? getComputedStyle(editor) : null;
    const scrollerStyle = scroller ? getComputedStyle(scroller) : null;
    return {
      cellHeight: el.getBoundingClientRect().height,
      editorHeight: editor?.getBoundingClientRect().height ?? 0,
      editorMinHeight: editorStyle?.minHeight ?? "",
      rowHeight: el.closest("tr")?.getBoundingClientRect().height ?? 0,
      scrollerHeight: scroller?.getBoundingClientRect().height ?? 0,
      scrollerMinHeight: scrollerStyle?.minHeight ?? "",
      viewportHeight: window.innerHeight,
    };
  });

  expect(after.rowHeight).toBeLessThan(160);
  expect(after.cellHeight).toBeLessThan(160);
  expect(after.editorHeight).toBeLessThan(120);
  expect(after.scrollerHeight).toBeLessThan(120);
  expect(after.scrollerMinHeight).not.toBe(`${after.viewportHeight}px`);
  expect(after.rowHeight).toBeLessThan(before.rowHeight + 120);
  expect(after.cellHeight).toBeLessThan(before.cellHeight + 120);
});

test("public demo hydrates bibliography citations", async ({ page }) => {
  await page.goto("/examples/simple/index.html");

  await expect.poll(() =>
    page.locator('.cf-citation[aria-label="cormen2009"], [data-ref-key="cormen2009"]').count()
  ).toBeGreaterThan(0);

  const firstCitation = page.locator('.cf-citation[aria-label="cormen2009"], [data-ref-key="cormen2009"]').first();
  await expect(firstCitation).toContainText("[1]");
  await expect(firstCitation).toHaveClass(/cf-citation/);
  await expect(firstCitation).not.toHaveClass(/cf-crossref-unresolved/);

  await firstCitation.hover();
  const tooltip = page.locator('.cf-hover-preview-tooltip[data-visible="true"]');
  await expect(tooltip).toContainText("Introduction to Algorithms");
  await expect(tooltip).toContainText("Cormen");
  await expectTooltipWithinViewport(page, tooltip);

  await page.getByRole("button", { name: "Reader" }).click();
  const reader = page.locator("#reader");
  await expect(reader.locator(".cf-bibliography")).toContainText("References");
  await expect(reader.locator(".cf-bibliography-entry").first()).toContainText("Introduction to Algorithms");
  const readerEndMatter = await page.locator("#reader").evaluate(async (readerRoot) => {
    const viewport = document.querySelector("#reader-viewport");
    if (viewport instanceof HTMLElement) {
      viewport.scrollTop = viewport.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return ((root: Element) => {
      const properties = ["font-size", "line-height", "white-space", "width"] as const;
      const snap = (selector: string) => {
        const el = root.querySelector(selector);
        if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          box: {
            height: Math.round(box.height * 100) / 100,
            width: Math.round(box.width * 100) / 100,
          },
          style: Object.fromEntries(properties.map((property) => [
            property,
            style.getPropertyValue(property),
          ])),
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        };
      };
      return {
        bibliography: snap(".cf-bibliography"),
        footnotes: snap(".cf-footnote-section"),
      };
    })(readerRoot);
  });

  await page.getByRole("button", { name: "Editor" }).click();
  await expect(page.locator("#editor .cm-editor")).toBeVisible();
  await expect.poll(() => page.locator("#editor").evaluate(async (editor) => {
    const scroller = editor.querySelector(".cm-scroller");
    if (!(scroller instanceof HTMLElement)) return 0;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return editor.querySelectorAll(".cf-bibliography, .cf-footnote-section").length;
  })).toBeGreaterThanOrEqual(2);
  const editorOrder = await page.locator("#editor").evaluate((editor) => {
    const scroller = editor.querySelector(".cm-scroller");
    if (!(scroller instanceof HTMLElement)) throw new Error("missing editor scroller");
    const bibliography = editor.querySelector(".cf-bibliography");
    const footnotes = editor.querySelector(".cf-footnote-section");
    if (!(bibliography instanceof HTMLElement) || !(footnotes instanceof HTMLElement)) {
      throw new Error("missing generated reference sections");
    }
    const properties = ["font-size", "line-height", "white-space", "width"] as const;
    const snap = (selector: string) => {
      const el = editor.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        box: {
          height: Math.round(box.height * 100) / 100,
          width: Math.round(box.width * 100) / 100,
        },
        style: Object.fromEntries(properties.map((property) => [
          property,
          style.getPropertyValue(property),
        ])),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    };
    return {
      bibliography: snap(".cf-bibliography"),
      footnotes: snap(".cf-footnote-section"),
      bibliographyTop: bibliography.getBoundingClientRect().top,
      footnotesTop: footnotes.getBoundingClientRect().top,
    };
  });
  expect(editorOrder.bibliography.text).toContain("References");
  expect(editorOrder.bibliography.text).toContain("Introduction to Algorithms");
  expect(editorOrder.footnotes.text).toContain("Footnotes");
  expect(editorOrder.bibliographyTop).toBeLessThan(editorOrder.footnotesTop);
  expect(editorOrder.bibliography).toEqual(readerEndMatter.bibliography);
  expect(editorOrder.footnotes).toEqual(readerEndMatter.footnotes);
});

test("public demo shows hover panels for cross-references", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 826 });
  await page.goto("/examples/simple/index.html");
  const gaussianReference = page.locator('[aria-label="[@eq:gaussian]"]').first();
  await scrollThroughUntil(page, [1000, 1200, 1400, 1600, 1800, 2000, 2200], gaussianReference);
  await expect(gaussianReference).toBeVisible();

  await gaussianReference.hover();

  const tooltip = page.locator('.cf-hover-preview-tooltip[data-visible="true"]');
  await expect(tooltip).toContainText("Eq. (1)");
  await expect(tooltip).toContainText("e^{-x^2}");
  await expectTooltipWithinViewport(page, tooltip);
});

test("blueprint book theme applies to a host-rendered reader document", async ({ page }) => {
  await page.goto("/tests/e2e/fixtures/theme.html");

  const shell = page.locator(".cf-reader-shell");
  const header = page.locator(".cf-reader-header");
  const reader = page.locator(".cf-reader");
  const toc = page.locator(".cf-reader-toc");
  const definition = page.locator(".cf-doc-block--definition");
  const theorem = page.locator(".cf-doc-block--theorem");
  const proof = page.locator(".cf-doc-block--proof");

  await expect(shell).toHaveAttribute("data-cf-theme", "blueprint-book");
  await expect(reader).toContainText("Every optimal document theme");
  await expect(header).toHaveCSS("background-image", /linear-gradient/);
  await expect(toc).toBeVisible();
  await expect(definition).toBeVisible();
  await expect(theorem).toBeVisible();
  await expect(proof).toBeVisible();

  const readerMaxWidth = await reader.evaluate((el) =>
    Math.round(Number.parseFloat(getComputedStyle(el).maxWidth))
  );
  expect(readerMaxWidth).toBeGreaterThanOrEqual(560);
  expect(readerMaxWidth).toBeLessThanOrEqual(800);
  await expect(reader).toHaveCSS("font-family", /KaTeX_Main/);
  await expect(toc).toHaveCSS("background-color", "rgb(102, 150, 187)");
  await expect(theorem).toHaveCSS("border-left-style", "solid");
  await expect(proof).toHaveCSS("border-left-style", "solid");

  await expect(theorem).toHaveAttribute("data-title", "Readable column");
  await expect(proof).toHaveAttribute("data-title", "the readable column theorem");
  await expect(theorem).toHaveAttribute("data-cf-block-open", "true");
  const theoremHeader = theorem.locator("> .cf-doc-block-heading");
  const theoremToggle = theoremHeader.locator("> .cf-block-disclosure-toggle");
  const theoremHeaderText = theoremHeader.locator("> .cf-block-heading-content");
  await expect(theoremHeader).toContainText("Theorem 1");
  await expect(theoremHeader).toContainText("Readable column");
  await expect(theoremToggle).toHaveAttribute("aria-expanded", "true");
  await expect(theoremToggle).toHaveCSS("font-style", "normal");
  await expect(proof).toContainText("Proof");
  await expect(theorem).toHaveCSS("font-style", "italic");
  await expect(proof).toHaveCSS("font-style", "normal");
  await expect(theorem).toHaveCSS("border-left-width", "2px");
  await expect(proof).toHaveCSS("border-left-width", "1px");
  const disclosureGeometry = await theorem.evaluate((el) => {
    const headingText = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-heading-content");
    const toggle = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-disclosure-toggle");
    const bodyParagraph = el.querySelector(":scope > .cf-block-disclosure-body .cf-doc-paragraph");
    if (!(headingText instanceof HTMLElement) || !(toggle instanceof HTMLElement) || !(bodyParagraph instanceof HTMLElement)) {
      throw new Error("missing theorem disclosure parts");
    }
    return {
      bodyTextLeft: bodyParagraph.getBoundingClientRect().left,
      headingTextLeft: headingText.getBoundingClientRect().left,
      toggleRight: toggle.getBoundingClientRect().right,
      toggleOpacity: getComputedStyle(toggle).opacity,
      toggleFontFamily: getComputedStyle(toggle).fontFamily,
      toggleFontSize: getComputedStyle(toggle).fontSize,
      headingFontSize: getComputedStyle(headingText).fontSize,
    };
  });
  expect(Math.abs(disclosureGeometry.headingTextLeft - disclosureGeometry.bodyTextLeft))
    .toBeLessThanOrEqual(1);
  expect(Math.abs(disclosureGeometry.headingTextLeft - disclosureGeometry.toggleRight - 4))
    .toBeLessThanOrEqual(0.5);
  expect(disclosureGeometry.toggleOpacity).toBe("0");
  expect(disclosureGeometry.toggleFontFamily).toContain("KaTeX_Main");
  expect(disclosureGeometry.toggleFontSize).toBe(disclosureGeometry.headingFontSize);

  const beforeHover = await theorem.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) {
      throw new Error("missing theorem disclosure body");
    }
    return {
      height: rect.height,
      railOpacity: getComputedStyle(body, "::before").opacity,
      width: rect.width,
    };
  });
  expect(beforeHover.railOpacity).toBe("0");
  await theorem.hover();
  expect(await theorem.evaluate((el) => {
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing theorem disclosure body");
    return getComputedStyle(body, "::before").opacity;
  })).toBe("0");
  await expect.poll(() => theoremToggle.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  await theoremToggle.hover();
  await expect.poll(() => theorem.evaluate((el) => {
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) throw new Error("missing theorem disclosure body");
    return getComputedStyle(body, "::before").opacity;
  }))
    .toBe("1");
  await expect.poll(() => theoremToggle.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  const afterHover = await theorem.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const toggle = el.querySelector(":scope > .cf-doc-block-heading > .cf-block-disclosure-toggle");
    if (!(toggle instanceof HTMLElement)) {
      throw new Error("missing theorem disclosure toggle");
    }
    const body = el.querySelector(":scope > .cf-block-disclosure-body");
    if (!(body instanceof HTMLElement)) {
      throw new Error("missing theorem disclosure body");
    }
    const railStyle = getComputedStyle(body, "::before");
    return {
      height: rect.height,
      railLeft: railStyle.left,
      railOpacity: railStyle.opacity,
      railTransform: railStyle.transform,
      railWidth: railStyle.width,
      toggleOpacity: getComputedStyle(toggle).opacity,
      width: rect.width,
    };
  });
  expect(afterHover.railLeft.startsWith("-")).toBe(true);
  expect(afterHover.railOpacity).toBe("1");
  expect(afterHover.railTransform).not.toBe("none");
  expect(afterHover.railWidth).toBe("2px");
  expect(afterHover.toggleOpacity).toBe("1");
  expect(Math.abs(afterHover.height - beforeHover.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(afterHover.width - beforeHover.width)).toBeLessThanOrEqual(0.5);

  await theoremToggle.click({ force: true });
  await expect(theoremToggle).toHaveAttribute("aria-expanded", "false");
  await expect(theoremToggle).toHaveCSS("font-style", "normal");
  await theoremToggle.click({ force: true });
  await expect(theoremToggle).toHaveAttribute("aria-expanded", "true");
  await expect(theoremToggle).toHaveCSS("font-style", "normal");

  await theoremHeaderText.click();
  await expect(theorem).toHaveAttribute("data-cf-block-open", "true");

  await theoremToggle.click();
  await expect(theorem).toHaveAttribute("data-cf-block-open", "false");
  await expect(theoremToggle).toHaveAttribute("aria-expanded", "false");
  await expect(theorem.locator(".cf-doc-paragraph")).toBeHidden();
});

test("theme presets keep reader and CM6 rich editor surfaces visually aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 });

  async function expectStylesMatch(
    readerSelector: string,
    editorSelector: string,
    properties: readonly string[],
  ) {
    const reader = page.locator(readerSelector).first();
    const editor = page.locator(editorSelector).first();
    await expect(reader).toBeVisible();
    await expect(editor).toBeVisible();

    for (const property of properties) {
      const expected = await reader.evaluate((el, property) =>
        getComputedStyle(el).getPropertyValue(property),
      property);
      await expect(editor).toHaveCSS(property, expected);
    }
  }

  const stylePairs = [
    [".parity-reader .cf-doc-paragraph", ".parity-editor .cf-paragraph-flow-widget .cf-doc-paragraph:has-text('This paragraph includes')", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader strong", ".parity-editor .cf-bold", ["font-weight"]],
    [".parity-reader em", ".parity-editor .cf-italic", ["font-style"]],
    [".parity-reader del", ".parity-editor .cf-strikethrough", ["text-decoration-line"]],
    [".parity-reader mark", ".parity-editor .cf-highlight", ["background-color", "border-radius", "color", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-code-token", ".parity-editor .cf-inline-code", ["background-color", "border-radius", "font-family", "font-size", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-paragraph .cf-doc-inline-math", ".parity-editor .cf-paragraph-flow-widget .cf-doc-paragraph .cf-doc-inline-math", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-paragraph .cf-doc-inline-math .katex", ".parity-editor .cf-paragraph-flow-widget .cf-doc-paragraph .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-heading--h3 .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-heading--h3 .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-list-item .cf-doc-inline-math .katex", ".parity-editor .cm-line:has-text('unordered item') .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader a", ".parity-editor .cf-link-rendered", ["color", "text-decoration-line", "text-decoration-thickness", "text-underline-offset"]],
    [".parity-reader .cf-doc-heading--h1", ".parity-editor .cm-line.cf-doc-heading--h1", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height", "text-align"]],
    [".parity-reader .cf-doc-heading--h2", ".parity-editor .cm-line.cf-doc-heading--h2", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-heading--h3", ".parity-editor .cm-line.cf-doc-heading--h3", ["color", "font-family", "font-size", "font-style", "font-weight", "line-height"]],
    [".parity-reader .cf-doc-list--unordered .cf-doc-list-item", ".parity-editor .cf-doc-list--unordered.cf-doc-list-item", ["font-family", "font-size", "line-height"]],
    [".parity-reader .cf-doc-list--ordered .cf-doc-list-item", ".parity-editor .cf-doc-list--ordered.cf-doc-list-item", ["font-family", "font-size", "line-height"]],
    [".parity-reader .cf-list-bullet", ".parity-editor .cf-list-bullet", ["color", "font-family", "font-weight"]],
    [".parity-reader .cf-list-number", ".parity-editor .cf-list-number", ["color", "font-family", "font-weight", "font-variant-numeric"]],
    [".parity-reader input[type='checkbox']", ".parity-editor input[type='checkbox']", ["vertical-align", "margin-right"]],
    [".parity-reader .cf-doc-code-block code", ".parity-editor .cf-codeblock-last", ["background-color", "font-family", "font-size", "line-height", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader .cf-doc-table-block", ".parity-editor .cf-table-widget table", ["border-collapse", "font-size"]],
    [".parity-reader .cf-doc-table-header", ".parity-editor .cf-doc-table-header", ["border-bottom-color", "border-bottom-style", "border-bottom-width", "font-weight", "line-height", "padding-left", "padding-right"]],
    [".parity-reader .cf-doc-table-cell:not(.cf-doc-table-header)", ".parity-editor .cf-doc-table-cell:not(.cf-doc-table-header)", ["border-left-color", "border-left-style", "border-left-width", "line-height", "padding-left", "padding-right", "text-align", "vertical-align", "white-space", "word-break", "overflow-wrap"]],
    [".parity-reader .cf-doc-display-math", ".parity-editor .cf-doc-display-math.cf-math-display", ["font-family", "font-size", "line-height", "text-align", "margin-top", "margin-bottom"]],
    [".parity-reader .cf-doc-display-math .katex-display", ".parity-editor .cf-doc-display-math.cf-math-display .katex-display", ["font-size", "margin-top", "margin-bottom", "text-align"]],
    [".parity-reader .cf-doc-display-math .katex-display > .katex", ".parity-editor .cf-doc-display-math.cf-math-display .katex-display > .katex", ["color", "font-size"]],
    [".parity-reader .cf-doc-block--theorem", ".parity-editor .cm-line.cf-doc-block--theorem", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--theorem .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-block--theorem .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-block--proof", ".parity-editor .cm-line.cf-doc-block--proof", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
    [".parity-reader .cf-doc-block--proof .cf-doc-inline-math .katex", ".parity-editor .cm-line.cf-doc-block--proof .cf-doc-inline-math .katex", ["color", "font-size", "font-style", "font-weight"]],
    [".parity-reader .cf-doc-block--definition", ".parity-editor .cm-line.cf-doc-block--definition", ["font-style"]],
    [".parity-reader .cf-doc-block--blockquote", ".parity-editor .cm-line.cf-doc-block--blockquote", ["border-left-color", "border-left-style", "border-left-width", "font-style", "padding-left"]],
  ] as const;

  for (const preset of PARITY_PIXEL_PRESETS) {
    await setParitySource(page, NESTED_MATH_PARITY_SOURCE);
    await page.goto(`/tests/e2e/fixtures/parity.html${preset === "default" ? "" : `?preset=${preset}`}`);
    for (const [readerSelector, editorSelector, properties] of stylePairs) {
      await expectStylesMatch(readerSelector, editorSelector, properties);
    }
    const referenceParagraph = page.locator(".parity-editor .cf-paragraph-flow-widget .cf-doc-paragraph", {
      hasText: "References should align too",
    });
    await expect(referenceParagraph).toContainText("[1]");
    await expect(referenceParagraph).toContainText("External Page");
    await expect(referenceParagraph).not.toContainText("[@karger2000]");
  }
});

test("theme presets keep full reader and CM6 content pixels aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });

  for (const preset of PARITY_PIXEL_PRESETS) {
    await loadParityPairSurface(page, preset);
    await expectLoadedSplitContentPixelsMatch(page, preset);
  }
});

test("reader and CM6 rich editor keep image and caption surfaces aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1800 });
  await loadParityPairSurface(page, "default", IMAGE_CAPTION_PARITY_SOURCE);

  const readerImageWrappers = page.locator(".parity-reader .cf-image-wrapper");
  const editorImageWrappers = page.locator(".parity-editor .cf-image-wrapper");
  await expect(readerImageWrappers).toHaveCount(2);
  await expect(editorImageWrappers).toHaveCount(2);

  await expect(page.locator(".parity-reader .cf-image-loading")).toHaveCount(2);
  await expect(page.locator(".parity-editor .cf-image-loading")).toHaveCount(2);
  await expect(page.locator(".parity-reader .cf-image-loading").first()).toContainText("[Loading image: Figure loading]");
  await expect(page.locator(".parity-editor .cf-image-loading").first()).toContainText("[Loading image: Figure loading]");
  await expect(page.locator(".parity-reader .cf-image-loading").nth(1)).toContainText("[Loading image: Loading alt]");
  await expect(page.locator(".parity-editor .cf-image-loading").nth(1)).toContainText("[Loading image: Loading alt]");

  const readerCaption = page.locator(".parity-reader .cf-block-caption");
  const editorCaption = page.locator(".parity-editor .cf-block-caption");
  await expect(readerCaption).toContainText("Figure 1");
  await expect(editorCaption).toContainText("Figure 1");
  await expect(readerCaption.locator(".cf-block-caption-text")).toContainText("Caption with doc, Figure 1");
  await expect(editorCaption.locator(".cf-block-caption-text")).toContainText("Caption with doc, Figure 1");
  await expect(readerCaption.locator(".cf-doc-link")).toHaveAttribute("data-cf-link-layout", "atomic");
  await expect(editorCaption.locator(".cf-doc-link")).toHaveAttribute("data-cf-link-layout", "atomic");
  await expect(readerCaption.locator(".cf-doc-inline-math .katex")).toBeVisible();
  await expect(editorCaption.locator(".cf-doc-inline-math .katex")).toBeVisible();
  await expect(readerCaption.locator(".cf-doc-code-token")).toContainText("code");
  await expect(editorCaption.locator(".cf-doc-code-token")).toContainText("code");

  for (const property of ["font-family", "font-size", "line-height", "text-align"] as const) {
    const expected = await readerCaption.evaluate((el, property) =>
      getComputedStyle(el).getPropertyValue(property),
    property);
    await expect(editorCaption).toHaveCSS(property, expected);
  }

  await expectLoadedSplitContentPixelsMatch(page, "image caption parity");
});

test("reader and CM6 rich editor keep indented display math in lists aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await loadParityPairSurface(page, "default", INDENTED_DISPLAY_MATH_PARITY_SOURCE);

  const result = await page.evaluate((finalItemFrom) => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const snap = (selector: string) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
      const rect = el.getBoundingClientRect();
      return {
        height: rounded(rect.height),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        top: rounded(rect.top),
      };
    };
    return {
      displayMath: {
        reader: snap("#reader-root .cf-doc-display-math"),
        editor: snap("#editor-root .cf-doc-display-math"),
      },
      finalItem: {
        reader: snap(`#reader-root .cf-doc-list-item[data-source-from='${finalItemFrom}']`),
        editor: snap(`#editor-root .cm-line[data-source-from='${finalItemFrom}']`),
      },
    };
  }, INDENTED_DISPLAY_MATH_FINAL_ITEM_FROM);

  expect(result.displayMath.editor.text).toBe(result.displayMath.reader.text);
  expect(result.displayMath.editor.height).toBe(result.displayMath.reader.height);
  expect(result.displayMath.editor.top).toBe(result.displayMath.reader.top);
  expect(result.finalItem.editor.top).toBe(result.finalItem.reader.top);
  await expectLoadedSelectorsPixelsMatch(page, "indented display math in list", {
    reader: "#reader-root .cf-doc-display-math",
    editor: "#editor-root .cf-doc-display-math",
  });
});

test("reader and CM6 rich editor keep blockquote display math aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await loadParityPairSurface(page, "default", BLOCKQUOTE_DISPLAY_MATH_PARITY_SOURCE);

  const result = await page.evaluate(() => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const snapAll = (rootSelector: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${rootSelector} .cf-doc-display-math`))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            className: el.className,
            height: rounded(rect.height),
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
            top: rounded(rect.top),
            width: rounded(rect.width),
          };
        });
    return {
      reader: snapAll("#reader-root"),
      editor: snapAll("#editor-root"),
    };
  });

  expect(result.reader).toHaveLength(2);
  expect(result.editor).toHaveLength(2);
  for (const [index, reader] of result.reader.entries()) {
    const editor = result.editor[index];
    expect(editor.text, `math ${index} text`).toBe(reader.text);
    expect(editor.width, `math ${index} width`).toBe(reader.width);
    expect(editor.height, `math ${index} height`).toBe(reader.height);
    if (index === 0) {
      expect(editor.top, `math ${index} top`).toBe(reader.top);
    } else {
      expect(Math.abs(editor.top - reader.top), `math ${index} top drift`).toBeLessThanOrEqual(8);
    }
  }

  await expectLoadedSelectorsPixelsMatch(page, "fenced blockquote display math", {
    reader: "#reader-root .cf-doc-display-math",
    editor: "#editor-root .cf-doc-display-math",
  });
});

test("reader and CM6 rich editor render root-relative browser images the same way", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 });
  await loadParityPairSurface(page, "default", ROOT_IMAGE_PARITY_SOURCE);

  const result = await page.evaluate(() => {
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const snapImage = (selector: string) => {
      const img = document.querySelector(selector);
      if (!(img instanceof HTMLImageElement)) throw new Error(`missing ${selector}`);
      const rect = img.getBoundingClientRect();
      return {
        complete: img.complete,
        height: rounded(rect.height),
        naturalHeight: img.naturalHeight,
        naturalWidth: img.naturalWidth,
        src: img.getAttribute("src") ?? "",
        width: rounded(rect.width),
      };
    };
    const snapParagraph = (selector: string) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
      const rect = el.getBoundingClientRect();
      return {
        height: rounded(rect.height),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        width: rounded(rect.width),
      };
    };
    return {
      images: {
        reader: snapImage("#reader-root img.cf-image"),
        editor: snapImage("#editor-root img.cf-image"),
      },
      paragraphs: {
        reader: snapParagraph("#reader-root .cf-doc-paragraph"),
        editor: snapParagraph("#editor-root .cm-line.cf-doc-paragraph"),
      },
    };
  });

  expect(result.images.reader.complete).toBe(true);
  expect(result.images.editor.complete).toBe(true);
  expect(result.images.editor.src).toBe(result.images.reader.src);
  expect(result.images.editor.naturalWidth).toBe(result.images.reader.naturalWidth);
  expect(result.images.editor.naturalHeight).toBe(result.images.reader.naturalHeight);
  expect(result.images.editor.width).toBe(result.images.reader.width);
  expect(result.images.editor.height).toBe(result.images.reader.height);
  expect(result.paragraphs.editor.text).toBe(result.paragraphs.reader.text);
  expect(result.paragraphs.editor.height).toBe(result.paragraphs.reader.height);
  await expectLoadedSelectorsPixelsMatch(page, "root-relative inline image paragraph", {
    reader: "#reader-root .cf-doc-paragraph",
    editor: "#editor-root .cm-line.cf-doc-paragraph",
  });
});

test("public showcase keeps reader and CM6 rich editor block geometry aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 7200 });

  await loadParityPairSurface(page, "default", PUBLIC_SHOWCASE_PARITY_SOURCE);
  const result = await page.evaluate((sourceEnd) => {
    type Row = {
      readonly className: string;
      readonly h: number;
      readonly range: string;
      readonly text: string;
      readonly w: number;
      readonly y: number;
    };
    type EditorViewLike = {
      readonly state: {
        readonly doc: {
          readonly length: number;
          lineAt(pos: number): { readonly from: number; readonly to: number };
        };
      };
      posAtDOM(node: Node, offset?: number): number;
    };
    const editorView = (
      window as typeof window & {
        __coflatEditorView?: EditorViewLike | null;
      }
    ).__coflatEditorView;
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const text = (el: Element) => (el.textContent ?? "")
      .replace(/\s+/g, " ")
      .replace(/^▼\s*/, "")
      .trim()
      .slice(0, 80);
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { h: rounded(r.height), w: rounded(r.width), y: rounded(r.y) };
    };
    const readerRows = Array.from(document.querySelectorAll<HTMLElement>([
      "#reader-root .cf-doc-title",
      "#reader-root .cf-doc-heading",
      "#reader-root .cf-doc-paragraph",
      "#reader-root .cf-doc-list-item",
      "#reader-root .cf-doc-display-math",
      "#reader-root .cf-doc-table-block",
      "#reader-root .cf-doc-code-block",
    ].join(","))).flatMap((el): Row[] => {
      const from = Number(el.dataset.sourceFrom);
      const to = Number(el.dataset.sourceTo);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= sourceEnd) return [];
      return [{
        className: el.className,
        range: `${from}:${to}`,
        text: text(el),
        ...rect(el),
      }];
    });
    const editorRows = Array.from(document.querySelectorAll<HTMLElement>([
      "#editor-root .cf-doc-title",
      "#editor-root .cm-line.cf-doc-heading",
      "#editor-root .cm-line.cf-doc-paragraph",
      "#editor-root .cf-paragraph-flow-widget .cf-doc-paragraph",
      "#editor-root .cf-doc-display-math",
      "#editor-root .cf-table-widget",
      "#editor-root .cf-doc-code-block",
    ].join(","))).flatMap((el): Row[] => {
      if (el.getBoundingClientRect().height <= 0) return [];
      let from: number | undefined;
      let to: number | undefined;
      if (el.dataset.sourceFrom !== undefined && el.dataset.sourceTo !== undefined) {
        from = Number(el.dataset.sourceFrom);
        to = Number(el.dataset.sourceTo);
      } else if (editorView && el.classList.contains("cm-line")) {
        from = editorView.posAtDOM(el, 0);
        const line = editorView.state.doc.lineAt(from);
        to = Math.min(editorView.state.doc.length, line.to + 1);
      }
      if (
        from === undefined ||
        to === undefined ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from >= sourceEnd
      ) return [];
      return [{
        className: el.className,
        range: `${from}:${to}`,
        text: text(el),
        ...rect(el),
      }];
    });
    const editorByRange = new Map(editorRows.map((row) => [row.range, row]));
    const mismatches = readerRows.flatMap((reader) => {
      const editor = editorByRange.get(reader.range);
      if (!editor) return [];
      const dy = rounded(editor.y - reader.y);
      const dh = rounded(editor.h - reader.h);
      const dw = rounded(editor.w - reader.w);
      const textMatches = editor.text === reader.text;
      if (Math.abs(dy) <= 1 && Math.abs(dh) <= 2.5 && Math.abs(dw) <= 1 && textMatches) {
        return [];
      }
      return [{ dh, dw, dy, textMatches, editor, reader }];
    });
    return {
      compared: readerRows.filter((row) => editorByRange.has(row.range)).length,
      mismatches,
    };
  }, PUBLIC_SHOWCASE_PARITY_END);

  expect(result.compared).toBeGreaterThan(75);
  expect(result.mismatches).toEqual([]);
});

test("public showcase keeps reader and rich editor footnote sections aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 7200 });
  await loadParityPairSurface(page, "default", PUBLIC_SHOWCASE_PARITY_SOURCE);

  await page.evaluate(async () => {
    const mounted = (
      window as typeof window & {
        __coflatEditor?: { setMode?: (mode: "rich" | "rich-readonly") => void };
      }
    ).__coflatEditor;
    mounted?.setMode?.("rich-readonly");
    mounted?.setMode?.("rich");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  await expectLoadedSelectorsPixelsMatch(page, "showcase footnote section rich editor", {
    reader: "#reader-root .cf-footnote-section",
    editor: "#editor-root .cf-footnote-section",
  });

  await page.evaluate(async () => {
    const mounted = (
      window as typeof window & {
        __coflatEditor?: { setMode?: (mode: "rich-readonly") => void };
      }
    ).__coflatEditor;
    mounted?.setMode?.("rich-readonly");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });

  const result = await page.evaluate(() => {
    const properties = [
      "color",
      "cursor",
      "display",
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "line-height",
      "margin-bottom",
      "margin-top",
      "padding-left",
      "padding-right",
      "text-align",
      "vertical-align",
    ] as const;
    const rounded = (value: number) => Math.round(value * 100) / 100;
    const style = (el: Element) => {
      const computed = getComputedStyle(el);
      return Object.fromEntries(properties.map((property) => [
        property,
        computed.getPropertyValue(property),
      ]));
    };
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { height: rounded(rect.height), width: rounded(rect.width) };
    };
    const snap = (selector: string) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
      return {
        box: box(el),
        style: style(el),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    };
    const pairs = [
      ["section", "#reader-root .cf-footnote-section", "#editor-root .cf-footnote-section"],
      ["heading", "#reader-root .cf-footnote-section .cf-bibliography-heading", "#editor-root .cf-footnote-section .cf-bibliography-heading"],
      ["entry", "#reader-root .cf-footnote-section .cf-bibliography-entry", "#editor-root .cf-footnote-section .cf-bibliography-entry"],
      ["number", "#reader-root .cf-footnote-section .cf-bibliography-entry-number", "#editor-root .cf-footnote-section .cf-bibliography-entry-number"],
      ["content", "#reader-root .cf-footnote-section .cf-bibliography-entry span", "#editor-root .cf-footnote-section .cf-bibliography-entry span"],
      ["backref", "#reader-root .cf-footnote-section .cf-footnote-backref", "#editor-root .cf-footnote-section .cf-footnote-backref"],
    ] as const;
    return Object.fromEntries(pairs.map(([name, readerSelector, editorSelector]) => [
      name,
      { reader: snap(readerSelector), editor: snap(editorSelector) },
    ]));
  });

  for (const [name, pair] of Object.entries(result)) {
    expect(pair.editor.text, `${name} text`).toBe(pair.reader.text);
    expect(pair.editor.box, `${name} box`).toEqual(pair.reader.box);
    expect(pair.editor.style, `${name} style`).toEqual(pair.reader.style);
  }

  await expectLoadedSelectorsPixelsMatch(page, "showcase footnote section rich-readonly", {
    reader: "#reader-root .cf-footnote-section",
    editor: "#editor-root .cf-footnote-section",
  });
});
