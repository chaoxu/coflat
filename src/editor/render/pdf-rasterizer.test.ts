import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument }));

import { rasterizePdfPage1 } from "./pdf-rasterizer";

describe("PDF loading task cleanup", () => {
  beforeEach(() => {
    getDocument.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders using PDF.js 6's document proxy and releases the loading task", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const cleanup = vi.fn();
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: async () => ({
          getViewport: ({ scale }: { scale: number }) => ({ width: 400 * scale, height: 600 * scale }),
          render,
          cleanup,
        }),
      }),
      destroy,
    });

    const canvas = await rasterizePdfPage1(new Uint8Array([37, 80, 68, 70]), { maxWidth: 200 });

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect([canvas?.width, canvas?.height]).toEqual([200, 300]);
    expect(render).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("releases a failed loading task and returns the documented fallback", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({ promise: Promise.reject(new Error("Malformed PDF")), destroy });

    expect(await rasterizePdfPage1(new Uint8Array())).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("releases the loading task when page rendering fails", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: async () => ({
          getViewport: () => ({ width: 10, height: 10 }),
          render: () => ({ promise: Promise.reject(new Error("Render failed")) }),
        }),
      }),
      destroy,
    });

    expect(await rasterizePdfPage1(new Uint8Array())).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
