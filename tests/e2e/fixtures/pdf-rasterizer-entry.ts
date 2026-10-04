import { GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
export { rasterizePdfPage1 } from "../../../src/editor/render/pdf-rasterizer";
