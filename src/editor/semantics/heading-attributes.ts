export interface TrailingHeadingAttributes {
  readonly index: number;
  readonly raw: string;
  readonly content: string;
}

/**
 * Pandoc attribute token: #id, .class, key=value, key="value", or the
 * dash/unnumbered shorthand flags ({-}, {.unnumbered}).
 */
function isPandocAttributeContent(content: string): boolean {
  let pos = skipSpaces(content, 0);
  if (pos >= content.length) return false;
  while (pos < content.length) {
    const next = readAttributeToken(content, pos);
    if (next === pos) return false;
    pos = skipSpaces(content, next);
  }
  return true;
}

export function findTrailingHeadingAttributes(
  text: string,
): TrailingHeadingAttributes | null {
  const trimmedEnd = trimEndIndex(text);
  if (trimmedEnd === 0 || text[trimmedEnd - 1] !== "}") return null;
  const open = text.lastIndexOf("{", trimmedEnd - 1);
  if (open < 0) return null;
  const rawStart = trimStartBefore(text, open);
  const content = text.slice(open + 1, trimmedEnd - 1);
  if (!isPandocAttributeContent(content)) return null;
  return {
    index: rawStart,
    raw: text.slice(rawStart, trimmedEnd),
    content,
  };
}

export function hasUnnumberedHeadingAttributes(text: string): boolean {
  return hasHeadingAttributeToken(text, "-", ".unnumbered", ".appendix");
}

export function hasAppendixHeadingAttribute(text: string): boolean {
  return hasHeadingAttributeToken(text, ".appendix");
}

function hasHeadingAttributeToken(text: string, ...tokens: readonly string[]): boolean {
  const attrs = findTrailingHeadingAttributes(text);
  if (attrs === null) return false;
  let pos = skipSpaces(attrs.content, 0);
  while (pos < attrs.content.length) {
    const next = readAttributeToken(attrs.content, pos);
    const token = attrs.content.slice(pos, next);
    if (tokens.includes(token)) return true;
    pos = skipSpaces(attrs.content, next);
  }
  return false;
}

function trimEndIndex(text: string): number {
  let end = text.length;
  while (end > 0 && isSpace(text[end - 1])) end--;
  return end;
}

function trimStartBefore(text: string, index: number): number {
  let start = index;
  while (start > 0 && isSpace(text[start - 1])) start--;
  return start;
}

function skipSpaces(text: string, start: number): number {
  let pos = start;
  while (pos < text.length && isSpace(text[pos])) pos++;
  return pos;
}

function readAttributeToken(text: string, start: number): number {
  const ch = text[start];
  if (ch === "-") return start + 1;
  if (ch === "#") return readBareToken(text, start + 1, isIdChar);
  if (ch === ".") return readBareToken(text, start + 1, isClassChar);
  if (!isAsciiWordStart(ch)) return start;

  let pos = start + 1;
  while (pos < text.length && isKeyChar(text[pos])) pos++;
  if (text[pos] !== "=") return start;
  pos++;
  if (text[pos] === "\"") {
    pos++;
    while (pos < text.length && text[pos] !== "\"") pos++;
    return text[pos] === "\"" ? pos + 1 : start;
  }
  const valueStart = pos;
  while (pos < text.length && !isSpace(text[pos])) pos++;
  return pos > valueStart ? pos : start;
}

function readBareToken(text: string, start: number, valid: (ch: string | undefined) => boolean): number {
  let pos = start;
  while (pos < text.length && valid(text[pos])) pos++;
  return pos > start ? pos : start - 1;
}

function isSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isAsciiWordStart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isAsciiWord(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return isAsciiWordStart(ch) || (ch >= "0" && ch <= "9");
}

function isIdChar(ch: string | undefined): boolean {
  return isAsciiWord(ch) || ch === ":" || ch === "." || ch === "-";
}

function isClassChar(ch: string | undefined): boolean {
  return isAsciiWord(ch) || ch === "-";
}

function isKeyChar(ch: string | undefined): boolean {
  return isAsciiWord(ch) || ch === "-";
}
