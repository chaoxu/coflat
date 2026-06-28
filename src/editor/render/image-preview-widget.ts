import {
  type EditorView,
  WidgetType,
} from "@codemirror/view";
import { CSS } from "../../core/constants/css-classes";
import { IMAGE_PREVIEW_RESERVED_HEIGHT_PX } from "../../core/constants/layout";
import {
  createImageElement,
  createMediaWrapperElement,
  renderImagePlaceholderInto,
  renderMediaLoadingInto,
  syncInlineImageSizeOnLoad,
} from "../../core/media-surface";
import {
  LazyWidgetBase,
  type LazyWidgetHeightSpec,
} from "./lazy-widget-base";
import type { MediaPreviewResult } from "./media-preview";
import { getPdfCanvas } from "./pdf-preview-cache";
import { RenderWidget } from "./source-widget";

export type ImagePreviewState =
  | { kind: "image"; src: string }
  | { kind: "pdf-canvas"; path: string }
  | { kind: "loading"; isPdf: boolean }
  | { kind: "error"; fallbackSrc: string };

const imagePreviewHeightCache = new Map<string, number>();

/**
 * Single widget class for all image preview states.
 *
 * Identity includes the preview state so CM6 does not treat a loading widget
 * as equivalent to its later ready/error version and keep stale DOM mounted.
 */
export class ImagePreviewWidget extends LazyWidgetBase {
  constructor(
    readonly alt: string,
    readonly src: string,
    readonly state: ImagePreviewState,
    readonly isBlock = false,
  ) {
    super();
  }

  protected get usesLazyBlockShell(): boolean {
    return this.isBlock;
  }

  private stateKey(): string {
    switch (this.state.kind) {
      case "image":
        return `image:${this.state.src}`;
      case "pdf-canvas":
        return `pdf-canvas:${this.state.path}`;
      case "loading":
        return `loading:${this.state.isPdf ? "pdf" : "image"}`;
      case "error":
        return `error:${this.state.fallbackSrc}`;
    }
  }

  createDOM(): HTMLElement {
    const wrapper = createMediaWrapperElement(document, this.isBlock ? "div" : "span");
    this.renderInto(wrapper);
    return wrapper;
  }

  private heightSpec(): LazyWidgetHeightSpec {
    return {
      cache: imagePreviewHeightCache,
      key: this.src,
      fallbackHeight: this.isBlock
        ? IMAGE_PREVIEW_RESERVED_HEIGHT_PX
        : this.state.kind === "loading"
          ? IMAGE_PREVIEW_RESERVED_HEIGHT_PX
          : -1,
    };
  }

  private observeMeasuredHeight(
    wrapper: HTMLElement,
    view: EditorView,
  ): void {
    this.observeLazyWidgetHeight(wrapper, view, this.heightSpec());
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ImagePreviewWidget &&
      this.alt === other.alt &&
      this.src === other.src &&
      this.isBlock === other.isBlock &&
      this.stateKey() === other.stateKey()
    );
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncLazyWidgetAttrs(el, view, this.isBlock);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    if (view) {
      this.observeMeasuredHeight(el, view);
    }
    return el;
  }

  updateDOM(dom: HTMLElement, view?: EditorView, from?: WidgetType): boolean {
    const expectedTag = this.isBlock ? "DIV" : "SPAN";
    if (dom.tagName !== expectedTag) return false;
    if (from instanceof ImagePreviewWidget) {
      from.clearLazyWidgetHeight();
    }
    dom.textContent = "";
    this.renderInto(dom);
    this.syncLazyWidgetAttrs(dom, view, this.isBlock);
    if (view) {
      this.observeMeasuredHeight(dom, view);
    }
    return true;
  }

  get estimatedHeight(): number {
    return this.estimatedLazyWidgetHeight(this.heightSpec());
  }

  private renderInto(wrapper: HTMLElement): void {
    switch (this.state.kind) {
      case "image": {
        wrapper.className = CSS.imageWrapper;
        const img = createImageElement(document, this.state.src, this.alt);
        if (!this.isBlock) {
          syncInlineImageSizeOnLoad(wrapper, img);
        }
        img.addEventListener("error", () => {
          this.renderUnavailablePlaceholder(wrapper);
        });
        wrapper.appendChild(img);
        break;
      }
      case "pdf-canvas": {
        const canvas = getPdfCanvas(this.state.path);
        if (canvas) {
          wrapper.className = CSS.imageWrapper;
          const clone = document.createElement("canvas");
          clone.width = canvas.width;
          clone.height = canvas.height;
          clone.style.maxWidth = "100%";
          clone.style.height = "auto";
          clone.setAttribute("role", "img");
          clone.setAttribute("aria-label", this.alt);
          const ctx = clone.getContext("2d");
          if (ctx) ctx.drawImage(canvas, 0, 0);
          wrapper.appendChild(clone);
        } else {
          this.renderUnavailablePlaceholder(wrapper);
        }
        break;
      }
      case "loading":
        renderMediaLoadingInto(wrapper, this.state.isPdf ? "pdf" : "image", this.alt);
        break;
      case "error": {
        if (this.isBlock) {
          this.renderUnavailablePlaceholder(wrapper);
          break;
        }
        wrapper.className = CSS.imageWrapper;
        const img = createImageElement(document, this.state.fallbackSrc, this.alt);
        img.addEventListener("error", () => {
          this.renderUnavailablePlaceholder(wrapper);
        });
        wrapper.appendChild(img);
        break;
      }
    }
  }

  private renderUnavailablePlaceholder(wrapper: HTMLElement): void {
    renderImagePlaceholderInto(wrapper, this.alt, { block: this.isBlock });
  }
}

export function mediaPreviewWidget(
  alt: string,
  src: string,
  result: MediaPreviewResult,
  isBlock: boolean,
): RenderWidget {
  switch (result.kind) {
    case "image":
      return new ImagePreviewWidget(alt, src, { kind: "image", src: result.dataUrl }, isBlock);
    case "pdf-canvas":
      return new ImagePreviewWidget(alt, src, { kind: "pdf-canvas", path: result.resolvedPath }, isBlock);
    case "loading":
      return new ImagePreviewWidget(alt, src, { kind: "loading", isPdf: result.isPdf }, isBlock);
    case "error":
      return new ImagePreviewWidget(alt, src, { kind: "error", fallbackSrc: result.fallbackSrc }, isBlock);
  }
}
