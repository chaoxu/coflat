/**
 * Phase 3.3 (#11) — AssetUploader integration tests.
 *
 * Exercises the public surface (`mountEditor` + `AssetUploader` +
 * `StatusEvents`) end-to-end through paste and drop DOM events.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { mountEditor, type MountedEditor } from "../editor";
import type {
  AssetUploader,
  StatusEvents,
} from "../editor";

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
  while (cleanups.length) cleanups.pop()!();
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
