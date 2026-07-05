/**
 * `@chaoxu/coflat/reader/worker` — off-main-thread renderer.
 *
 * This module is dual-purpose:
 *
 * 1. **Worker entry.** When loaded inside a Web Worker (detected via
 *    `WorkerGlobalScope`), it installs a `message` listener that
 *    dispatches RPC requests to `renderToHtml` / `renderToText` from
 *    `./reader` and posts the result back.
 *
 * 2. **Client factory.** When imported by host code, it exposes
 *    {@link createWorkerReader}, which spins up a Worker, tracks pending
 *    requests by sequence id, and exposes a Promise-based API mirroring
 *    the synchronous reader.
 *
 * The same compiled file (`dist/reader-worker.mjs`) is the worker
 * script *and* the client module. Hosts using Vite/Webpack/Rollup load
 * the worker via `new Worker(new URL("./reader-worker.mjs",
 * import.meta.url), { type: "module" })`. The bundler rewrites that URL
 * at build time. Hosts that resolve the worker URL themselves (CDN,
 * custom asset loader) can pass it as `WorkerReaderOptions.workerUrl`.
 *
 * ## v1 limitations
 *
 * Functions do not cross `postMessage`, so {@link WorkerReaderRenderInput}
 * intentionally omits `linkResolver`, `refResolver`, and `fileSystem`.
 * The worker renders against a pure-string snapshot. Hosts that need
 * resolver-driven output should either render in-thread or post-process
 * the worker's HTML after it arrives.
 *
 * Sanitization: DOMPurify needs a DOM and is unavailable in a worker
 * (there is no `window`). The wrapped `./reader` falls back to
 * unsanitized output in that case; the renderer's output is safe by
 * construction for the inline subset (every emitted string runs through
 * `escapeHtml` and URLs through `isSafeUrl`). Hosts that want defence in
 * depth can re-sanitize on the main thread after the worker returns.
 *
 * KaTeX is not used in the worker. Math placeholders cross the boundary
 * verbatim; call `hydrateMath` from `./reader` on the main thread after
 * inserting the worker's HTML.
 */

import { type ReaderReferencePreviewIndex, renderToHtml, renderToText } from "./reader";

// ---------------------------------------------------------------------------
// Wire protocol.
// ---------------------------------------------------------------------------

/** @internal Message payload sent client → worker. */
interface WorkerRequest {
  id: number;
  method: "renderToHtml" | "renderToText";
  input: WorkerReaderRenderInput;
}

/** @internal Message payload sent worker → client. */
type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export interface WorkerReaderOptions {
  /**
   * Optional URL of the worker script. If omitted, the factory uses
   * `new URL("./reader-worker.mjs", import.meta.url)` — the canonical
   * pattern Vite/Webpack/Rollup understand for bundling worker assets.
   */
  workerUrl?: URL | string;
}

export interface WorkerReaderRenderInput {
  source: string;
  /**
   * KaTeX macro definitions to forward to the host's eventual
   * `hydrateMath` call. The worker itself does not invoke KaTeX; this
   * field is preserved here so a single round-trip can carry everything
   * the host needs.
   */
  mathMacros?: Record<string, string>;
  truncate?: { lines: number } | { chars: number };
  sourceLineAttribution?: boolean;
  referencePreviews?: boolean;
}

export interface WorkerReaderHtmlResult {
  html: string;
  hasMath: boolean;
  truncated?: { sourceFrom: number; sourceTo: number };
  /**
   * Resolved KaTeX macros for this document (frontmatter `math:` merged with
   * any `mathMacros` supplied on the request). Forward this to the main-thread
   * `hydrateMath` call.
   */
  mathMacros?: Record<string, string>;
  referencePreviewIndex?: ReaderReferencePreviewIndex;
}

export interface WorkerReaderTextResult {
  text: string;
  truncated?: { sourceFrom: number; sourceTo: number };
  sourceToText?: Uint32Array;
}

export interface WorkerReader {
  renderToHtml(input: WorkerReaderRenderInput): Promise<WorkerReaderHtmlResult>;
  renderToText(input: WorkerReaderRenderInput): Promise<WorkerReaderTextResult>;
  terminate(): void;
}

// ---------------------------------------------------------------------------
// Worker-side: install the message handler if we're running in a worker.
// ---------------------------------------------------------------------------

declare const WorkerGlobalScope: { new (): object; prototype: object } | undefined;

function isWorkerContext(): boolean {
  return (
    typeof WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof WorkerGlobalScope
  );
}

function handleRequest(req: WorkerRequest): WorkerResponse {
  try {
    const { method, input, id } = req;
    if (method === "renderToHtml") {
      const r = renderToHtml(
        input.source,
        input.mathMacros ? { mathMacros: input.mathMacros } : undefined,
        {
          sourceLineAttribution: input.sourceLineAttribution,
          truncate: input.truncate,
          referencePreviews: input.referencePreviews,
        },
      );
      return { id, ok: true, result: r };
    }
    if (method === "renderToText") {
      const r = renderToText(input.source, undefined, {
        truncate: input.truncate,
      });
      return { id, ok: true, result: r };
    }
    return { id: req.id, ok: false, error: `Unknown method: ${String(method)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `req` may be malformed (e.g. null data). Never let `req.id` throw here,
    // or the failure escapes handleRequest and surfaces as an uncaught worker
    // 'error' event that tears down the whole reader.
    const id = req && typeof req.id === "number" ? req.id : -1;
    return { id, ok: false, error: msg };
  }
}

if (isWorkerContext()) {
  // `self` is typed as Window in a tsconfig that targets DOM; cast to
  // the worker scope for `postMessage`.
  const scope = self as unknown as {
    addEventListener: (type: "message", h: (e: MessageEvent) => void) => void;
    postMessage: (msg: unknown) => void;
  };
  scope.addEventListener("message", (ev) => {
    const req = ev.data as WorkerRequest;
    const res = handleRequest(req);
    scope.postMessage(res);
  });
}

// ---------------------------------------------------------------------------
// Client-side factory.
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the Worker interface the factory depends on. Lets
 * tests substitute an in-memory fake without dragging in the real
 * `Worker` global.
 */
type WorkerLikeEvent = { data?: unknown; message?: string };

interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (ev: WorkerLikeEvent) => void,
  ): void;
  removeEventListener?(
    type: "message" | "error" | "messageerror",
    listener: (ev: WorkerLikeEvent) => void,
  ): void;
}

/** @internal Test seam. Hosts shouldn't reach for this directly. */
export interface CreateWorkerReaderInternal extends WorkerReaderOptions {
  /** Test seam: inject a pre-constructed worker instead of spawning one. */
  workerFactory?: () => WorkerLike;
}

/**
 * Construct an off-main-thread reader.
 *
 * The returned object owns a single Worker; concurrent calls are
 * multiplexed over it by sequence id. Hosts that want parallelism
 * across CPU cores should create multiple readers.
 *
 * Errors thrown inside the worker (parser crashes, etc.) reject the
 * corresponding promise with an `Error` carrying the original message.
 */
export function createWorkerReader(opts?: WorkerReaderOptions): WorkerReader {
  return createWorkerReaderInternal(opts);
}

/** @internal */
export function createWorkerReaderInternal(
  opts?: CreateWorkerReaderInternal,
): WorkerReader {
  const worker: WorkerLike = opts?.workerFactory
    ? opts.workerFactory()
    : spawnDefaultWorker(opts?.workerUrl);

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  // Once the worker dies (failed load, crash, terminate) it never comes back:
  // reject everything outstanding and fail future requests fast instead of
  // leaving their promises pending forever.
  let broken: Error | null = null;

  const failAllPending = (err: Error): void => {
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  };

  const onMessage = (ev: WorkerLikeEvent): void => {
    const res = ev.data as WorkerResponse;
    if (!res || typeof res.id !== "number") return;
    const entry = pending.get(res.id);
    if (!entry) return;
    pending.delete(res.id);
    if (res.ok) entry.resolve(res.result);
    else entry.reject(new Error(res.error));
  };
  // 'error' is fatal: a worker that fails to load or throws at module scope
  // never recovers. ('messageerror' — a per-message deserialization failure —
  // is intentionally NOT treated as fatal; it cannot occur with these
  // JSON-shaped payloads and latching the whole reader on it would be wrong.)
  const onError = (ev: WorkerLikeEvent): void => {
    broken ??= new Error(
      `Worker failed: ${
        typeof ev?.message === "string" && ev.message
          ? ev.message
          : "worker failed to load or crashed"
      }`,
    );
    failAllPending(broken);
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);

  function request<T>(
    method: WorkerRequest["method"],
    input: WorkerReaderRenderInput,
  ): Promise<T> {
    if (broken) return Promise.reject(broken);
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      worker.postMessage({ id, method, input } satisfies WorkerRequest);
    });
  }

  return {
    renderToHtml(input) {
      return request<WorkerReaderHtmlResult>("renderToHtml", input);
    },
    renderToText(input) {
      return request<WorkerReaderTextResult>("renderToText", input);
    },
    terminate() {
      worker.removeEventListener?.("message", onMessage);
      worker.removeEventListener?.("error", onError);
      worker.terminate();
      const err = new Error("Worker terminated");
      broken ??= err;
      // Reject any outstanding requests so callers don't hang.
      failAllPending(err);
    },
  };
}

function spawnDefaultWorker(workerUrl: URL | string | undefined): WorkerLike {
  if (typeof Worker === "undefined") {
    throw new Error(
      "createWorkerReader: Worker is not available in this environment.",
    );
  }
  const url =
    workerUrl ?? new URL(/* @vite-ignore */ "./reader-worker.mjs", import.meta.url);
  return new Worker(url, { type: "module" }) as unknown as WorkerLike;
}
