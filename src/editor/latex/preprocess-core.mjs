import { parse as parseYaml, stringify as yamlStringify } from "yaml";

import {
  FRONTMATTER_DELIMITER,
  isFrontmatterDelimiterLine,
} from "../lib/frontmatter-delimiter.js";

/**
 * Move a fenced-div opener's trailing inline title into a `title="..."`
 * attribute. The editor displays `::: {#id .class} My Title` by putting the
 * title text after the attr block; pandoc's `fenced_divs` reader drops that
 * text. Hoisting it into an attribute preserves it as `el.attributes.title`.
 */
const FENCE_WITH_TITLE_RE = /^(:::+)\s*\{([^}]*)\}\s+(\S.*?)\s*$/;

export function liftFencedDivTitles(markdown) {
  const out = [];
  for (const line of markdown.split("\n")) {
    const match = FENCE_WITH_TITLE_RE.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const [, fence, attrs, title] = match;
    const escaped = title.replace(/"/g, '\\"');
    out.push(`${fence} {${attrs} title="${escaped}"}`);
  }
  return out.join("\n");
}

const FRONTMATTER_FENCE = FRONTMATTER_DELIMITER;

/**
 * Rewrite labeled display-math blocks into raw-LaTeX equation environments.
 * Coflat's convention puts the id on the closing fence line:
 *
 *   $$
 *   body
 *   $$ {#eq:foo}
 *
 * Pandoc's tex_math_dollars reader treats the `{#eq:foo}` as plain text and
 * drops the label on the floor. Converting to `\begin{equation}\label{}...
 * \end{equation}` preserves the label and lets \cref{eq:foo} resolve.
 */
export function promoteLabeledDisplayMath(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let i = 0;
  const openRe = /^\$\$\s*$/;
  const closeWithLabelRe = /^\$\$\s*\{#([A-Za-z][\w:-]*)\}\s*$/;
  while (i < lines.length) {
    if (!openRe.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let end = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (closeWithLabelRe.test(lines[j]) || openRe.test(lines[j])) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const closer = closeWithLabelRe.exec(lines[end]);
    if (!closer) {
      for (let j = i; j <= end; j += 1) out.push(lines[j]);
      i = end + 1;
      continue;
    }
    const id = closer[1];
    const body = lines.slice(i + 1, end).join("\n");
    out.push(`\\begin{equation}\\label{${id}}`);
    out.push(body);
    out.push("\\end{equation}");
    i = end + 1;
  }
  return out.join("\n");
}

function countMacroArgs(body) {
  let max = 0;
  const re = /#(\d)/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max;
}

export function renderMathMacros(math) {
  const names = Object.keys(math).sort();
  const lines = [];
  for (const rawName of names) {
    const body = math[rawName];
    if (typeof body !== "string") continue;
    const cleanName = rawName.replace(/^\\+/, "");
    const nargs = countMacroArgs(body);
    const sig = nargs > 0 ? `[${nargs}]` : "";
    lines.push(`\\newcommand{\\${cleanName}}${sig}{${body}}`);
  }
  return lines.join("\n");
}

/**
 * Hoist trusted `math:` frontmatter into a `header-includes` raw-LaTeX block,
 * bypassing pandoc's inline YAML parser (which re-parses the macro body
 * and mangles commands like `\rho` or `\operatorname`). User-supplied
 * `header-includes` are intentionally dropped for the web export profile.
 */
export function hoistMathMacros(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) return markdown;
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (isFrontmatterDelimiterLine(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return markdown;
  const raw = lines.slice(1, closeIdx).join("\n");
  let doc;
  try {
    doc = parseYaml(raw);
  } catch (_error) {
    return markdown;
  }
  if (!doc || typeof doc !== "object") {
    return markdown;
  }
  const math = doc.math && typeof doc.math === "object" ? doc.math : null;
  if (!math && doc["header-includes"] === undefined) {
    return markdown;
  }
  delete doc.math;
  delete doc["header-includes"];

  if (math) {
    const preamble = renderMathMacros(math);
    if (preamble) {
      doc["header-includes"] = preamble;
    }
  }

  const newYaml = yamlStringify(doc).trimEnd();
  const rest = lines.slice(closeIdx + 1).join("\n");
  return `${FRONTMATTER_FENCE}\n${newYaml}\n${FRONTMATTER_FENCE}\n${rest}`;
}

function splitFrontmatter(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) {
    return { doc: {}, bodyLines: lines };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (isFrontmatterDelimiterLine(lines[i])) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { doc: {}, bodyLines: lines };
  try {
    const parsed = parseYaml(lines.slice(1, closeIdx).join("\n"));
    return {
      doc: parsed && typeof parsed === "object" ? parsed : {},
      bodyLines: lines.slice(closeIdx + 1),
    };
  } catch (_error) {
    return { doc: {}, bodyLines: lines };
  }
}

function isAbstractFenceOpener(line) {
  return /^(:{3,})\s*\{[^}]*\.abstract(?:[\s#.][^}]*)?\}\s*$/.exec(line);
}

function isFenceCloser(line, fence) {
  const match = /^(:{3,})\s*$/.exec(line);
  return Boolean(match && match[1].length >= fence.length);
}

const APPENDIX_HEADING_RE = /^(#)([ \t]+)(.*?)([ \t]+\{([^}]*)\})([ \t]*#*[ \t]*)$/;

function isFenceLine(line) {
  return /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
}

function splitFrontmatterLines(markdown) {
  const lines = markdown.split("\n");
  if (!isFrontmatterDelimiterLine(lines[0] ?? "")) {
    return { bodyLines: lines, frontmatterLines: [] };
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (isFrontmatterDelimiterLine(lines[i])) {
      return {
        bodyLines: lines.slice(i + 1),
        frontmatterLines: lines.slice(0, i + 1),
      };
    }
  }
  return { bodyLines: lines, frontmatterLines: [] };
}

function fenceInfo(match) {
  if (!match) return null;
  const marker = match[1];
  return {
    char: marker[0],
    length: marker.length,
    tail: match[2] ?? "",
  };
}

function isFenceClose(candidate, opener) {
  return (
    candidate.char === opener.char &&
    candidate.length >= opener.length &&
    /^[ \t]*$/.test(candidate.tail)
  );
}

function latexEnvironmentName(line, kind) {
  const match = new RegExp(`^\\\\${kind}\\{([^}]+)\\}`).exec(line);
  return match?.[1] ?? null;
}

function opensMathBlock(line) {
  if (/^[ \t]*\$\$[ \t]*$/.test(line)) return { kind: "dollars" };
  if (/^[ \t]*\\\[[ \t]*$/.test(line)) return { kind: "brackets" };
  const environment = latexEnvironmentName(line, "begin");
  return environment ? { kind: "environment", environment } : null;
}

function closesMathBlock(line, block) {
  if (block.kind === "dollars") return /^[ \t]*\$\$(?:[ \t]+\{[^}]*\})?[ \t]*$/.test(line);
  if (block.kind === "brackets") return /^[ \t]*\\\][ \t]*$/.test(line);
  return latexEnvironmentName(line, "end") === block.environment;
}

function normalizeAppendixHeadingAttrs(rawAttrs) {
  const tokens = rawAttrs.trim().split(/\s+/).filter(Boolean);
  if (!tokens.includes(".appendix")) return null;
  const kept = tokens.filter((token) => token !== ".appendix");
  if (!kept.includes(".unnumbered") && !kept.includes("-")) {
    kept.push(".unnumbered");
  }
  return kept.length > 0 ? `{${kept.join(" ")}}` : "{.unnumbered}";
}

function headingInfo(line) {
  const match = /^(#{1,6})([ \t]+)(.*?)([ \t]*#*[ \t]*)$/.exec(line);
  if (!match) return null;
  const attrMatch = /[ \t]+\{([^}]*)\}[ \t]*#*[ \t]*$/.exec(line);
  const attrTokens = attrMatch ? attrMatch[1].trim().split(/\s+/).filter(Boolean) : [];
  return {
    level: match[1].length,
    unnumbered: attrTokens.includes(".unnumbered") || attrTokens.includes("-"),
  };
}

/**
 * Export path compatibility: Coflat treats `# Appendix {.appendix}` as a
 * semantic boundary heading. Pandoc/LaTeX needs an explicit `\appendix` command
 * before that boundary, and the boundary heading itself must stay unnumbered.
 */
export function insertAppendixBoundary(markdown) {
  const { bodyLines, frontmatterLines } = splitFrontmatterLines(markdown);
  const out = [];
  let emitted = false;
  let seededImplicitAppendix = false;
  let activeFence = null;
  let activeMathBlock = null;

  for (const line of bodyLines) {
    const currentFence = fenceInfo(isFenceLine(line));
    if (currentFence) {
      if (activeFence === null) {
        activeFence = currentFence;
      } else if (isFenceClose(currentFence, activeFence)) {
        activeFence = null;
      }
      out.push(line);
      continue;
    }

    if (activeFence !== null) {
      out.push(line);
      continue;
    }

    if (activeMathBlock !== null) {
      if (closesMathBlock(line, activeMathBlock)) {
        activeMathBlock = null;
      }
      out.push(line);
      continue;
    }

    const mathBlock = opensMathBlock(line);
    if (mathBlock !== null) {
      activeMathBlock = mathBlock;
      out.push(line);
      continue;
    }

    if (emitted && !seededImplicitAppendix) {
      const heading = headingInfo(line);
      if (heading && !heading.unnumbered) {
        if (heading.level > 1) {
          out.push("\\setcounter{section}{1}");
        }
        seededImplicitAppendix = true;
      }
    }

    if (emitted) {
      out.push(line);
      continue;
    }

    const match = APPENDIX_HEADING_RE.exec(line);
    const attrs = match ? normalizeAppendixHeadingAttrs(match[5]) : null;
    if (!match || attrs === null) {
      out.push(line);
      continue;
    }

    out.push("\\appendix");
    out.push(`${match[1]}${match[2]}${match[3].trimEnd()} ${attrs}${match[6]}`);
    emitted = true;
  }

  return [...frontmatterLines, ...out].join("\n");
}

/**
 * Export path compatibility: Coflat treats `::: {.abstract}` as normal document
 * prose, while Pandoc templates expect an `abstract` metadata field. Hoist the
 * first abstract block body into YAML and remove that block from the body.
 */
export function hoistAbstractBlock(markdown) {
  const { doc, bodyLines } = splitFrontmatter(markdown);
  const out = [];
  let abstractLines = null;

  for (let i = 0; i < bodyLines.length; i += 1) {
    if (abstractLines !== null) {
      out.push(bodyLines[i]);
      continue;
    }
    const opener = isAbstractFenceOpener(bodyLines[i]);
    if (!opener) {
      out.push(bodyLines[i]);
      continue;
    }
    const fence = opener[1];
    let closeIdx = -1;
    for (let j = i + 1; j < bodyLines.length; j += 1) {
      if (isFenceCloser(bodyLines[j], fence)) {
        closeIdx = j;
        break;
      }
    }
    if (closeIdx === -1) {
      out.push(bodyLines[i]);
      continue;
    }
    abstractLines = bodyLines.slice(i + 1, closeIdx);
    i = closeIdx;
  }

  if (abstractLines === null) return markdown;
  doc.abstract = abstractLines.join("\n").trim();
  const newYaml = yamlStringify(doc).trimEnd();
  return `${FRONTMATTER_FENCE}\n${newYaml}\n${FRONTMATTER_FENCE}\n${out.join("\n").replace(/^\n+/, "")}`;
}

/**
 * Full pre-pandoc pipeline: hoist math macros, hoist abstract blocks, insert
 * appendix boundaries, promote labeled display math, then lift fenced-div
 * titles. The root frontmatter is preserved (minus `math:`, which is rewritten
 * into `header-includes`) so pandoc reads it as metadata.
 */
export async function preprocessWithReadFile(markdown) {
  const withMacros = hoistMathMacros(markdown);
  const withAbstract = hoistAbstractBlock(withMacros);
  const withAppendix = insertAppendixBoundary(withAbstract);
  const withEquations = promoteLabeledDisplayMath(withAppendix);
  return liftFencedDivTitles(withEquations);
}
