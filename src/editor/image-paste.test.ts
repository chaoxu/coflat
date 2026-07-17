import { describe, expect, it, vi } from "vitest";
import { imagePasteExtension } from "./image-paste";
import { escapeMarkdownPath } from "./image-save";
import { createTestView } from "./test-utils";

describe("escapeMarkdownPath", () => {
  // Regression: paths containing `)` or spaces break CommonMark image syntax
  // because `)` terminates the URL in `![alt](url)` and spaces split the link.
  // See #346.

  it("leaves simple relative paths unchanged", () => {
    expect(escapeMarkdownPath("assets/image.png")).toBe("assets/image.png");
  });

  it("encodes spaces so the URL is not split", () => {
    expect(escapeMarkdownPath("my images/photo.png")).toBe("my%20images/photo.png");
  });

  it("encodes closing parenthesis to prevent link termination", () => {
    expect(escapeMarkdownPath("assets/foo(1).png")).toBe("assets/foo(1%29.png");
  });

  it("encodes both spaces and closing parentheses", () => {
    expect(escapeMarkdownPath("my files/foo (1).png")).toBe("my%20files/foo%20(1%29.png");
  });

  it("leaves data URLs intact except for encoded characters", () => {
    const dataUrl = "data:image/png;base64,abc123==";
    // No spaces or ) in this data URL — should pass through unchanged.
    expect(escapeMarkdownPath(dataUrl)).toBe(dataUrl);
  });

  it("handles an empty string", () => {
    expect(escapeMarkdownPath("")).toBe("");
  });

  it("does not encode other special characters", () => {
    // Characters like &, %, #, etc. are not encoded — only ) and space.
    expect(escapeMarkdownPath("assets/image-2024_01.png")).toBe(
      "assets/image-2024_01.png",
    );
  });
});

describe("imagePasteExtension paste-intent heuristic", () => {
  // Ported from Zettlr: whenever "text/plain" is on the clipboard the user
  // intends to paste text — an image flavor is only an app's fallback
  // (MS Office writes text/plain, text/html, text/rtf AND image/png).

  function firePaste(
    view: ReturnType<typeof createTestView>,
    options: { withPlainText: boolean },
  ): Event {
    const file = new File(["png-bytes"], "shot.png", { type: "image/png" });
    // jsdom's ClipboardEvent has no clipboardData support out of the box —
    // construct a base Event and attach the property.
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        types: options.withPlainText ? ["Files", "text/plain"] : ["Files"],
        items: [{ type: "image/png", getAsFile: () => file }],
        getData: (type: string) =>
          options.withPlainText && type === "text/plain" ? "hello" : "",
      },
    });
    view.contentDOM.dispatchEvent(event);
    return event;
  }

  function pasteView() {
    return createTestView("", {
      extensions: [imagePasteExtension({ saveImage: async () => "assets/pasted.png" })],
    });
  }

  it("inserts the image when the clipboard has no text flavor", async () => {
    const view = pasteView();
    const event = firePaste(view, { withPlainText: false });
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toContain("![shot](assets/pasted.png)");
    });
  });

  it("stands down when text/plain accompanies the image (text intent)", async () => {
    const view = pasteView();
    firePaste(view, { withPlainText: true });
    // Let any (wrongly started) async save/insert settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.state.doc.toString()).not.toContain("![");
  });
});
