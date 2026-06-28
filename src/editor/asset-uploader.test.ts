/**
 * AssetUploader integration tests.
 *
 * Exercises the public surface (`mountEditor` + `AssetUploader` +
 * `StatusEvents`) end-to-end through paste and drop DOM events.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { mountEditor, type MountedEditor } from "../../editor";
import { statusEventsFacet } from "./editor-host-api";
import type {
  AssetUploader,
  StatusEvents,
} from "../../editor";
import {
  assetUploaderExtension,
  formatUploadedAssetMarkdown,
  isUploadedAssetImage,
  uploadedAssetLabel,
} from "./asset-uploader";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Harness {
  editor: MountedEditor;
  parent: HTMLElement;
  events: {
    onAssetUploading: ReturnType<typeof vi.fn>;
    onAssetUploadSucceeded: ReturnType<typeof vi.fn>;
    onAssetUploadFailed: ReturnType<typeof vi.fn>;
  };
  uploader: AssetUploader;
  uploadCalls: Array<{
    file: File;
    deferred: Deferred<
      { path: string; alt?: string } | { error: string }
    >;
  }>;
  cancelCalls: File[];
  accept?: AssetUploader["accept"];
}

function makeHarness(
  opts: { accept?: AssetUploader["accept"]; doc?: string } = {},
): Harness {
  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const events = {
    onAssetUploading: vi.fn(),
    onAssetUploadSucceeded: vi.fn(),
    onAssetUploadFailed: vi.fn(),
  };

  const uploadCalls: Harness["uploadCalls"] = [];
  const cancelCalls: File[] = [];
  const uploader: AssetUploader = {
    upload: vi.fn(async (file: File) => {
      const deferred = defer<
        { path: string; alt?: string } | { error: string }
      >();
      uploadCalls.push({ file, deferred });
      return deferred.promise;
    }),
    accept: opts.accept,
    cancel: vi.fn((file: File) => {
      cancelCalls.push(file);
    }),
  };

  const editor = mountEditor({
    parent,
    doc: opts.doc ?? "hello",
    assetUploader: uploader,
    statusEvents: events as StatusEvents,
  });

  return { editor, parent, events, uploader, uploadCalls, cancelCalls };
}

function makeFile(name: string, body = "x"): File {
  return new File([body], name, { type: "image/png" });
}

function makeFileList(files: File[]): FileList {
  // jsdom doesn't expose a FileList constructor; fake it with index access.
  const list = Object.assign(files.slice(), {
    item(i: number) {
      return files[i] ?? null;
    },
  }) as unknown as FileList;
  return list;
}

function getContent(parent: HTMLElement): HTMLElement {
  const el = parent.querySelector(".cm-content");
  if (!el) throw new Error("no .cm-content");
  return el as HTMLElement;
}

function firePaste(parent: HTMLElement, files: File[]): void {
  const content = getContent(parent);
  // jsdom's ClipboardEvent has no clipboardData support out of the box —
  // construct a base Event and attach the property.
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: makeFileList(files),
      items: [],
      types: ["Files"],
    },
  });
  content.dispatchEvent(event);
}

function fireDrop(parent: HTMLElement, files: File[]): void {
  const content = getContent(parent);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: makeFileList(files),
      types: ["Files"],
      dropEffect: "copy",
    },
  });
  Object.defineProperty(event, "clientX", { value: 0 });
  Object.defineProperty(event, "clientY", { value: 0 });
  content.dispatchEvent(event);
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function track(h: Harness): void {
  cleanups.push(() => {
    h.editor.unmount();
    h.parent.remove();
  });
}

async function flush(): Promise<void> {
  // Let microtasks settle.
  await Promise.resolve();
  await Promise.resolve();
}

function makeDirectUploadView(args: {
  doc?: string;
  selection?: number;
  uploader?: AssetUploader;
  events?: {
    onAssetUploading: ReturnType<typeof vi.fn>;
    onAssetUploadSucceeded: ReturnType<typeof vi.fn>;
    onAssetUploadFailed: ReturnType<typeof vi.fn>;
  };
} = {}): {
  parent: HTMLElement;
  view: EditorView;
  events: {
    onAssetUploading: ReturnType<typeof vi.fn>;
    onAssetUploadSucceeded: ReturnType<typeof vi.fn>;
    onAssetUploadFailed: ReturnType<typeof vi.fn>;
  };
  uploader: AssetUploader;
} {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const events = args.events ?? {
    onAssetUploading: vi.fn(),
    onAssetUploadSucceeded: vi.fn(),
    onAssetUploadFailed: vi.fn(),
  };
  const uploader = args.uploader ?? {
    upload: vi.fn(async () => ({ path: "assets/a.png" })),
    cancel: vi.fn(),
  };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: args.doc ?? "hello",
      selection: { anchor: args.selection ?? 0 },
      extensions: [
        statusEventsFacet.of(events as StatusEvents),
        assetUploaderExtension(uploader),
      ],
    }),
  });
  cleanups.push(() => {
    view.destroy();
    parent.remove();
  });
  return { parent, view, events, uploader };
}

function expectNoFullDocMaterialization(task: () => void): void {
  const toStringSpy = vi.spyOn(Text.prototype, "toString");
  toStringSpy.mockClear();
  try {
    task();
    expect(toStringSpy).not.toHaveBeenCalled();
  } finally {
    toStringSpy.mockRestore();
  }
}

describe("uploaded asset Markdown helpers", () => {
  it("detects images by MIME type or filename", () => {
    expect(isUploadedAssetImage({ mimeType: "image/png" })).toBe(true);
    expect(isUploadedAssetImage({ name: "diagram.svg" })).toBe(true);
    expect(
      isUploadedAssetImage({
        mimeType: "application/pdf",
        name: "paper.pdf",
      }),
    ).toBe(false);
  });

  it("derives a safe label from the uploaded filename", () => {
    expect(uploadedAssetLabel("chart[final].png")).toBe("chart final");
    expect(uploadedAssetLabel("")).toBe("asset");
  });

  it("formats image uploads with escaped paths", () => {
    expect(
      formatUploadedAssetMarkdown({
        path: "assets/my figure(1).png",
        name: "my figure.png",
        mimeType: "image/png",
      }),
    ).toBe("![my figure](assets/my%20figure(1%29.png)");
  });

  it("formats non-image uploads as links", () => {
    expect(
      formatUploadedAssetMarkdown({
        path: "assets/data sheet.pdf",
        name: "data sheet.pdf",
        mimeType: "application/pdf",
      }),
    ).toBe("[data sheet](assets/data%20sheet.pdf)");
  });

  it("can force image markup with an empty alt for placeholder rewrites", () => {
    expect(
      formatUploadedAssetMarkdown({
        path: "assets/a.png",
        alt: "",
        kind: "image",
      }),
    ).toBe("![](assets/a.png)");
  });
});

describe("assetUploaderExtension paste", () => {
  it("inserts a placeholder at the cursor and calls upload(file)", async () => {
    const h = makeHarness();
    track(h);
    const file = makeFile("a.png");

    firePaste(h.parent, [file]);
    await flush();

    expect(h.uploadCalls).toHaveLength(1);
    expect(h.uploadCalls[0].file).toBe(file);
    const doc = h.editor.getDoc();
    expect(doc).toMatch(/!\[uploading…\]\(upload:[^)]+\)/);
    // Placeholder is appended at cursor (which started at 0); the
    // remainder of the original doc follows.
    expect(doc).toContain("hello");
    expect(h.events.onAssetUploading).toHaveBeenCalledTimes(1);
    const ev = h.events.onAssetUploading.mock.calls[0][0];
    expect(ev.file).toBe(file);
    expect(typeof ev.placeholderId).toBe("string");
  });

  it("on resolve rewrites the placeholder to the returned path and fires onAssetUploadSucceeded", async () => {
    const h = makeHarness();
    track(h);

    firePaste(h.parent, [makeFile("a.png")]);
    await flush();
    const { placeholderId } = h.events.onAssetUploading.mock.calls[0][0];

    h.uploadCalls[0].deferred.resolve({ path: "assets/a.png" });
    await flush();
    await flush();

    expect(h.editor.getDoc()).toContain("![](assets/a.png)");
    expect(h.editor.getDoc()).not.toContain("upload:");
    expect(h.events.onAssetUploadSucceeded).toHaveBeenCalledWith({
      placeholderId,
      path: "assets/a.png",
    });
  });

  it("accept() returning { reject } skips upload and fires onAssetUploadFailed without inserting a placeholder", async () => {
    const reject = vi.fn(() => ({ reject: "too big" }));
    const h = makeHarness({ accept: reject });
    track(h);
    const docBefore = h.editor.getDoc();

    firePaste(h.parent, [makeFile("a.png")]);
    await flush();

    expect(reject).toHaveBeenCalledTimes(1);
    expect(h.uploadCalls).toHaveLength(0);
    expect(h.editor.getDoc()).toBe(docBefore);
    expect(h.events.onAssetUploadFailed).toHaveBeenCalledWith({
      placeholderId: "<synthetic>",
      error: "too big",
    });
    expect(h.events.onAssetUploading).not.toHaveBeenCalled();
  });

  it("upload returning { error } rewrites the placeholder to an upload-error marker and fires onAssetUploadFailed", async () => {
    const h = makeHarness();
    track(h);

    firePaste(h.parent, [makeFile("a.png")]);
    await flush();
    const { placeholderId } = h.events.onAssetUploading.mock.calls[0][0];

    h.uploadCalls[0].deferred.resolve({ error: "network down" });
    await flush();
    await flush();

    const doc = h.editor.getDoc();
    expect(doc).toContain(
      `![upload failed: network down](upload-error:${placeholderId})`,
    );
    expect(doc).not.toContain(`upload:${placeholderId}`);
    expect(h.events.onAssetUploadFailed).toHaveBeenCalledWith({
      placeholderId,
      error: "network down",
    });
  });

  it("placeholder deletion before resolve calls cancel(file) and fires onAssetUploadFailed with 'cancelled'", async () => {
    const h = makeHarness();
    track(h);
    const file = makeFile("a.png");

    firePaste(h.parent, [file]);
    await flush();
    const { placeholderId } = h.events.onAssetUploading.mock.calls[0][0];

    // Remove the placeholder from the doc.
    const doc = h.editor.getDoc();
    const stripped = doc.replace(
      `![uploading…](upload:${placeholderId})`,
      "",
    );
    h.editor.setDoc(stripped);
    await flush();

    expect(h.cancelCalls).toEqual([file]);
    expect(h.events.onAssetUploadFailed).toHaveBeenCalledWith({
      placeholderId,
      error: "cancelled",
    });

    // The host's later resolve must not rewrite anything stale.
    const after = h.editor.getDoc();
    h.uploadCalls[0].deferred.resolve({ path: "assets/a.png" });
    await flush();
    await flush();
    expect(h.editor.getDoc()).toBe(after);
    expect(h.events.onAssetUploadSucceeded).not.toHaveBeenCalled();
  });

  it("multiple files in one paste produce distinct placeholders", async () => {
    const h = makeHarness();
    track(h);
    const a = makeFile("a.png", "a");
    const b = makeFile("b.png", "b");

    firePaste(h.parent, [a, b]);
    await flush();

    expect(h.uploadCalls).toHaveLength(2);
    expect(h.uploadCalls[0].file).toBe(a);
    expect(h.uploadCalls[1].file).toBe(b);
    const calls = h.events.onAssetUploading.mock.calls;
    expect(calls.length).toBe(2);
    const ids = new Set(calls.map((c) => c[0].placeholderId));
    expect(ids.size).toBe(2);

    h.uploadCalls[0].deferred.resolve({ path: "assets/a.png" });
    h.uploadCalls[1].deferred.resolve({ path: "assets/b.png" });
    await flush();
    await flush();

    const doc = h.editor.getDoc();
    expect(doc).toContain("![](assets/a.png)");
    expect(doc).toContain("![](assets/b.png)");
    expect(doc).not.toContain("upload:");
  });

  it("tracks pending placeholders without materializing the full document", async () => {
    const deferred = defer<{ path: string; alt?: string } | { error: string }>();
    const uploader: AssetUploader = {
      upload: vi.fn(async () => deferred.promise),
      cancel: vi.fn(),
    };
    const { parent, view, events } = makeDirectUploadView({ uploader });

    firePaste(parent, [makeFile("a.png")]);
    await flush();
    expect(events.onAssetUploading).toHaveBeenCalledTimes(1);

    expectNoFullDocMaterialization(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: "x" } });
    });
    expect(uploader.cancel).not.toHaveBeenCalled();
    expect(events.onAssetUploadFailed).not.toHaveBeenCalled();

    deferred.resolve({ path: "assets/a.png" });
    await flush();
    await flush();
    expect(view.state.doc.toString()).toContain("![](assets/a.png)");
    expect(events.onAssetUploadSucceeded).toHaveBeenCalledTimes(1);
  });

  it("keeps a nonzero placeholder alive across edits before and after it", async () => {
    const deferred = defer<{ path: string; alt?: string } | { error: string }>();
    const uploader: AssetUploader = {
      upload: vi.fn(async () => deferred.promise),
      cancel: vi.fn(),
    };
    const { parent, view, events } = makeDirectUploadView({
      doc: "abcdef",
      selection: 3,
      uploader,
    });

    firePaste(parent, [makeFile("a.png")]);
    await flush();
    expect(events.onAssetUploading).toHaveBeenCalledTimes(1);

    expectNoFullDocMaterialization(() => {
      view.dispatch({ changes: { from: 0, to: 0, insert: "X" } });
      view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: "Y" } });
    });
    expect(uploader.cancel).not.toHaveBeenCalled();
    expect(events.onAssetUploadFailed).not.toHaveBeenCalled();

    deferred.resolve({ path: "assets/a.png" });
    await flush();
    await flush();

    expect(view.state.doc.toString()).toContain("Xabc![](assets/a.png)defY");
    expect(events.onAssetUploadSucceeded).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending upload when editing inside its placeholder", async () => {
    const deferred = defer<{ path: string; alt?: string } | { error: string }>();
    const file = makeFile("a.png");
    const uploader: AssetUploader = {
      upload: vi.fn(async () => deferred.promise),
      cancel: vi.fn(),
    };
    const { parent, view, events } = makeDirectUploadView({ uploader });

    firePaste(parent, [file]);
    await flush();
    const { placeholderId } = events.onAssetUploading.mock.calls[0][0];

    expectNoFullDocMaterialization(() => {
      view.dispatch({ changes: { from: 2, to: 2, insert: "broken" } });
    });

    expect(uploader.cancel).toHaveBeenCalledWith(file);
    expect(events.onAssetUploadFailed).toHaveBeenCalledWith({
      placeholderId,
      error: "cancelled",
    });

    deferred.resolve({ path: "assets/a.png" });
    await flush();
    await flush();
    expect(events.onAssetUploadSucceeded).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).not.toContain("![](assets/a.png)");
  });

  it("rewrites multiple pending placeholders when uploads complete out of order", async () => {
    const first = defer<{ path: string; alt?: string } | { error: string }>();
    const second = defer<{ path: string; alt?: string } | { error: string }>();
    const uploader: AssetUploader = {
      upload: vi.fn(async (file) => file.name === "a.png" ? first.promise : second.promise),
      cancel: vi.fn(),
    };
    const { parent, view, events } = makeDirectUploadView({ uploader });

    firePaste(parent, [makeFile("a.png"), makeFile("b.png")]);
    await flush();
    expect(events.onAssetUploading).toHaveBeenCalledTimes(2);

    second.resolve({ path: "assets/b.png", alt: "b" });
    await flush();
    await flush();
    expect(view.state.doc.toString()).toContain("![b](assets/b.png)");
    expect(view.state.doc.toString()).toMatch(/upload:/);

    first.resolve({ path: "assets/a.png", alt: "a" });
    await flush();
    await flush();

    const doc = view.state.doc.toString();
    expect(doc).toContain("![a](assets/a.png)");
    expect(doc).toContain("![b](assets/b.png)");
    expect(doc).not.toContain("upload:");
    expect(uploader.cancel).not.toHaveBeenCalled();
    expect(events.onAssetUploadSucceeded).toHaveBeenCalledTimes(2);
  });
});

describe("assetUploaderExtension drop", () => {
  it("treats drop the same as paste", async () => {
    const h = makeHarness();
    track(h);
    const file = makeFile("dropped.png");

    fireDrop(h.parent, [file]);
    await flush();

    expect(h.uploadCalls).toHaveLength(1);
    expect(h.uploadCalls[0].file).toBe(file);
    expect(h.editor.getDoc()).toMatch(/!\[uploading…\]\(upload:[^)]+\)/);
    expect(h.events.onAssetUploading).toHaveBeenCalledTimes(1);

    h.uploadCalls[0].deferred.resolve({ path: "drops/x.png", alt: "x" });
    await flush();
    await flush();
    expect(h.editor.getDoc()).toContain("![x](drops/x.png)");
    expect(h.events.onAssetUploadSucceeded).toHaveBeenCalledTimes(1);
  });
});

describe("assetUploaderExtension unmount", () => {
  it("cancels in-flight uploads on unmount", async () => {
    const h = makeHarness();
    // Don't auto-track — we unmount manually below.
    cleanups.push(() => {
      h.parent.remove();
    });
    const file = makeFile("a.png");

    firePaste(h.parent, [file]);
    await flush();
    expect(h.uploadCalls).toHaveLength(1);

    h.editor.unmount();

    expect(h.cancelCalls).toEqual([file]);

    // Late resolve after unmount must not throw.
    h.uploadCalls[0].deferred.resolve({ path: "x.png" });
    await flush();
    await flush();
  });
});
