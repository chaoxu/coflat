/**
 * Tests for `./reader/worker`.
 *
 * Real `Worker` isn't available in vitest's jsdom environment (jsdom does
 * not implement web workers). We test by wiring `createWorkerReaderInternal`
 * with a `workerFactory` returning an in-memory fake that delivers
 * `postMessage` payloads to the same `handleRequest` path the real worker
 * uses, asynchronously via microtasks. That exercises the client-side
 * promise-tracking logic, the request/response protocol, and the actual
 * `renderToHtml` / `renderToText` calls.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createWorkerReaderInternal,
  type WorkerReader,
} from "../../reader-worker";
import { renderToHtml, renderToText } from "../../reader";

// ---------------------------------------------------------------------------
// Fake worker: simulates the worker by relaying messages through the same
// renderer functions on a microtask delay (so promises behave as if the
// work were truly off-thread).
// ---------------------------------------------------------------------------

interface FakeWorkerHandle {
  worker: {
    postMessage: (msg: unknown) => void;
    terminate: () => void;
    addEventListener: (
      type: "message",
      listener: (ev: { data: unknown }) => void,
    ) => void;
    removeEventListener: (
      type: "message",
      listener: (ev: { data: unknown }) => void,
    ) => void;
  };
  terminated: () => boolean;
}

function makeFakeWorker(opts?: { delayMs?: number }): FakeWorkerHandle {
  const listeners = new Set<(ev: { data: unknown }) => void>();
  let terminated = false;

  const deliver = (data: unknown): void => {
    for (const l of listeners) l({ data });
  };

  return {
    worker: {
      postMessage(msg: unknown) {
        if (terminated) return;
        const schedule = opts?.delayMs
          ? (cb: () => void) => setTimeout(cb, opts.delayMs)
          : (cb: () => void) => queueMicrotask(cb);
        schedule(() => {
          if (terminated) return;
          const req = msg as {
            id: number;
            method: "renderToHtml" | "renderToText";
            input: {
              source: string;
              truncate?: { lines: number } | { chars: number };
              sourceLineAttribution?: boolean;
              referencePreviews?: boolean;
            };
          };
          try {
            if (req.method === "renderToHtml") {
              const r = renderToHtml(req.input.source, undefined, {
                sourceLineAttribution: req.input.sourceLineAttribution,
                truncate: req.input.truncate,
                referencePreviews: req.input.referencePreviews,
              });
              deliver({ id: req.id, ok: true, result: r });
            } else {
              const r = renderToText(req.input.source, undefined, {
                truncate: req.input.truncate,
              });
              deliver({ id: req.id, ok: true, result: r });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            deliver({ id: req.id, ok: false, error: message });
          }
        });
      },
      terminate() {
        terminated = true;
        listeners.clear();
      },
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      },
    },
    terminated: () => terminated,
  };
}

function makeReader(handle?: FakeWorkerHandle): {
  reader: WorkerReader;
  handle: FakeWorkerHandle;
} {
  const h = handle ?? makeFakeWorker();
  const reader = createWorkerReaderInternal({
    workerFactory: () => h.worker,
  });
  return { reader, handle: h };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("createWorkerReader — renderToHtml round-trip", () => {
  it("returns sanitized HTML for a simple paragraph", async () => {
    const { reader } = makeReader();
    const res = await reader.renderToHtml({ source: "**bold** text" });
    expect(res.html).toContain("<strong>bold</strong>");
    expect(res.hasMath).toBe(false);
    reader.terminate();
  });

  it("propagates hasMath for math input", async () => {
    const { reader } = makeReader();
    const res = await reader.renderToHtml({ source: "Pythagoras: $a^2+b^2=c^2$" });
    expect(res.hasMath).toBe(true);
    expect(res.html).toContain("data-math");
    reader.terminate();
  });

  it("forwards sourceLineAttribution", async () => {
    const { reader } = makeReader();
    const res = await reader.renderToHtml({
      source: "# Heading\n\nbody",
      sourceLineAttribution: true,
    });
    expect(res.html).toContain('data-source-line="1"');
    reader.terminate();
  });

  it("forwards requested reference preview indexes", async () => {
    const { reader } = makeReader();
    const res = await reader.renderToHtml({
      source: "# Heading {#sec:heading}\n\nSee [@sec:heading].",
      referencePreviews: true,
    });
    expect(res.referencePreviewIndex?.["sec:heading"]).toMatchObject({
      kind: "heading",
      label: "Section 1",
      title: "Heading",
    });
    reader.terminate();
  });
});

describe("createWorkerReader — renderToText round-trip", () => {
  it("strips markup", async () => {
    const { reader } = makeReader();
    const res = await reader.renderToText({ source: "**bold** _it_" });
    expect(res.text).toBe("bold it");
    reader.terminate();
  });
});

describe("createWorkerReader — truncate propagation", () => {
  it("returns truncated info when budget is exceeded", async () => {
    const { reader } = makeReader();
    const src = ["# A", "", "para1", "", "para2", "", "para3"].join("\n");
    const res = await reader.renderToHtml({
      source: src,
      truncate: { lines: 2 },
    });
    expect(res.truncated).toBeDefined();
    expect(res.truncated?.sourceFrom).toBeGreaterThan(0);
    reader.terminate();
  });
});

describe("createWorkerReader — error handling", () => {
  it("rejects when the worker handler throws", async () => {
    const { reader } = makeReader();
    // `null` as source forces `FAST_PATH_RE.test(null)` to throw inside
    // the renderer — verifies error forwarding.
    await expect(
      reader.renderToHtml({ source: null as unknown as string }),
    ).rejects.toThrow();
    reader.terminate();
  });
});

describe("createWorkerReader — lifecycle", () => {
  it("terminate() stops the worker and rejects in-flight requests", async () => {
    const handle = makeFakeWorker({ delayMs: 50 });
    const { reader } = makeReader(handle);
    const pending = reader.renderToHtml({ source: "hello" });
    reader.terminate();
    expect(handle.terminated()).toBe(true);
    await expect(pending).rejects.toThrow(/terminated/i);
  });
});

describe("createWorkerReader — concurrency", () => {
  it("dispatches concurrent requests by sequence id, regardless of resolution order", async () => {
    // Build a fake that resolves messages out-of-order.
    const listeners = new Set<(ev: { data: unknown }) => void>();
    const queue: Array<() => void> = [];

    const worker = {
      postMessage(msg: unknown) {
        const req = msg as {
          id: number;
          method: "renderToHtml" | "renderToText";
          input: { source: string };
        };
        queue.push(() => {
          const r = renderToHtml(req.input.source);
          for (const l of listeners) l({ data: { id: req.id, ok: true, result: r } });
        });
      },
      terminate() {
        listeners.clear();
      },
      addEventListener(_t: "message", l: (ev: { data: unknown }) => void) {
        listeners.add(l);
      },
      removeEventListener(_t: "message", l: (ev: { data: unknown }) => void) {
        listeners.delete(l);
      },
    };

    const reader = createWorkerReaderInternal({ workerFactory: () => worker });

    const pA = reader.renderToHtml({ source: "**A**" });
    const pB = reader.renderToHtml({ source: "_B_" });
    const pC = reader.renderToHtml({ source: "C" });

    // Flush in reverse order: C, A, B.
    queue[2]();
    queue[0]();
    queue[1]();

    const [a, b, c] = await Promise.all([pA, pB, pC]);
    expect(a.html).toContain("<strong>A</strong>");
    expect(b.html).toContain("<em>B</em>");
    expect(c.html).toBe("C");

    reader.terminate();
  });
});

describe("createWorkerReader — default spawn path", () => {
  it("throws a clear error when no Worker global is available", () => {
    const originalWorker = (
      globalThis as unknown as { Worker?: unknown }
    ).Worker;
    (globalThis as unknown as { Worker?: unknown }).Worker = undefined;
    try {
      expect(() => createWorkerReaderInternal()).toThrow(/Worker is not available/);
    } finally {
      (globalThis as unknown as { Worker?: unknown }).Worker = originalWorker;
    }
  });

  it("uses the configured workerUrl when one is provided", () => {
    const stub = {
      postMessage: () => {},
      terminate: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const mkWorker = vi.fn().mockImplementation(function MockWorker() {
      return stub;
    });
    const originalWorker = (
      globalThis as unknown as { Worker?: unknown }
    ).Worker;
    (globalThis as unknown as { Worker?: unknown }).Worker = mkWorker;
    try {
      createWorkerReaderInternal({ workerUrl: "https://example.test/w.mjs" });
      expect(mkWorker).toHaveBeenCalledTimes(1);
      const call = mkWorker.mock.calls[0];
      expect(call[0]).toBe("https://example.test/w.mjs");
      expect(call[1]).toEqual({ type: "module" });
    } finally {
      (globalThis as unknown as { Worker?: unknown }).Worker = originalWorker;
    }
  });
});
