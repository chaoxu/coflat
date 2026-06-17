import { CSS } from "./constants/css-classes";
import {
  DOCUMENT_SURFACE_CLASS,
} from "./document-surface-classes";
import { escapeHtml } from "./lib/html-escape";

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
    const languageEl = ownerDocument.createElement("span");
    languageEl.className = CSS.codeblockLanguage;
    languageEl.textContent = language;
    pre.appendChild(languageEl);
  }
  if (codeClass) code.className = codeClass;
  code.textContent = codeText;
  pre.appendChild(code);
  parent.appendChild(pre);
}
