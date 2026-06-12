/**
 * Escape a string for safe interpolation into HTML markup.
 *
 * Escapes `&`, `<`, `>`, `"`, and `'`, so the result is safe in both
 * text content and (double- or single-quoted) attribute values.
 */
export function escapeHtml(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 38: out += "&amp;"; break;   // &
      case 60: out += "&lt;"; break;    // <
      case 62: out += "&gt;"; break;    // >
      case 34: out += "&quot;"; break;  // "
      case 39: out += "&#39;"; break;   // '
      default: out += s[i];
    }
  }
  return out;
}
