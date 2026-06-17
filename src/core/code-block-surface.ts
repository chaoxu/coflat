import { CSS } from "./constants/css-classes";
import { COPY_RESET_MS } from "./constants/timing";
import {
  DOCUMENT_SURFACE_CLASS,
} from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";
import { createLucideIcon, type IconNode } from "./lib/lucide-icon";

export interface CodeBlockCopyButtonIcons {
  readonly copy: IconNode;
  readonly check: IconNode;
}

export interface CodeBlockCopyButtonController {
  readonly element: HTMLButtonElement;
  destroy(): void;
}

interface CodeBlockCopyButtonOptions {
  readonly clipboard?: Pick<Clipboard, "writeText">;
  readonly setTimeout?: typeof globalThis.setTimeout;
  readonly clearTimeout?: typeof globalThis.clearTimeout;
  readonly onError?: (error: unknown) => void;
}

export function codeBlockLanguageToken(language: string): string {
  return language.split(/\s+/)[0] ?? "";
}

export function codeBlockLanguageClass(language: string): string {
  const languageToken = codeBlockLanguageToken(language);
  return /^[A-Za-z0-9_-]+$/.test(languageToken)
    ? `language-${languageToken}`
    : "";
}

export function renderCodeBlockHtml(
  language: string,
  code: string,
  attrs = "",
): string {
  const langAttr = language ? ` data-lang="${escapeHtml(language)}"` : "";
  const codeClass = codeBlockLanguageClass(language);
  return (
    `<pre class="${DOCUMENT_SURFACE_CLASS.codeBlock}"${langAttr}${attrs}>` +
    (language ? `<span class="${CSS.codeblockLanguage}">${escapeHtml(language)}</span>` : "") +
    `<code${codeClass ? ` class="${escapeHtml(codeClass)}"` : ""}>${escapeHtml(code)}</code></pre>`
  );
}

export function createCodeBlockLanguageElement(
  ownerDocument: Document,
  language: string,
): HTMLSpanElement {
  const languageEl = ownerDocument.createElement("span");
  languageEl.className = CSS.codeblockLanguage;
  languageEl.textContent = language;
  return languageEl;
}

export function createCodeBlockCopyButtonController(
  ownerDocument: Document,
  code: string,
  icons: CodeBlockCopyButtonIcons,
  options: CodeBlockCopyButtonOptions = {},
): CodeBlockCopyButtonController {
  const clipboard = options.clipboard ?? navigator.clipboard;
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;
  const onError = options.onError ?? ((error: unknown) => {
    console.error("[code-block] clipboard write failed", error);
  });
  const button = ownerDocument.createElement("button");
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const clearResetTimer = (): void => {
    const timer = resetTimer;
    resetTimer = null;
    if (timer !== null) clearTimer(timer);
  };
  const showCopy = (): void => {
    button.replaceChildren(createLucideIcon(icons.copy, "copy"));
    button.setAttribute("aria-label", "Copy code to clipboard");
  };
  const showCopied = (): void => {
    button.replaceChildren(createLucideIcon(icons.check, "check"));
    button.setAttribute("aria-label", "Copied");
  };

  button.className = CSS.codeblockCopy;
  button.type = "button";
  showCopy();
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void clipboard.writeText(code).then(() => {
      if (!button.isConnected) return;
      showCopied();
      clearResetTimer();
      resetTimer = setTimer(() => {
        resetTimer = null;
        if (button.isConnected) showCopy();
      }, COPY_RESET_MS);
    }).catch(onError);
  });

  return {
    element: button,
    destroy: clearResetTimer,
  };
}

export function appendCodeBlockDom(
  parent: HTMLElement | DocumentFragment,
  ownerDocument: Document,
  language: string,
  codeText: string,
): void {
  const pre = ownerDocument.createElement("pre");
  const code = ownerDocument.createElement("code");
  const codeClass = codeBlockLanguageClass(language);

  pre.className = DOCUMENT_SURFACE_CLASS.codeBlock;
  if (language) {
    pre.dataset.lang = language;
    pre.appendChild(createCodeBlockLanguageElement(ownerDocument, language));
  }
  if (codeClass) code.className = codeClass;
  code.textContent = codeText;
  pre.appendChild(code);
  parent.appendChild(pre);
}
