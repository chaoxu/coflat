# Coflat Document Format

Pandoc Markdown with a fixed set of Pandoc extensions and pandoc-crossref conventions for mathematical writing. This document specifies the canonical input format the editor expects.

Canonical documents must be parseable by Pandoc. Coflat semantics are encoded with Pandoc-native constructs such as YAML metadata, fenced divs, attributes, citations, raw LaTeX, and tables, plus pandoc-crossref-style labels for equations and cross-references. Non-Pandoc authoring sugar is not part of the canonical format.

The canonical reader profile is:

```text
markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark
```

The canonical filter profile runs `pandoc-crossref` before `citeproc` when exporting through Pandoc, because equation, figure, table, and block references use citation-like syntax.

## Editor and Reader Surfaces

Coflat has two runtime surfaces for the same document format:

- The editor surface (`@chaoxu/coflat`) mounts a CodeMirror-based rich/source editor for authoring, source rewrites, selections, autocomplete, structure editing, and inline widgets.
- The reader surface (`@chaoxu/coflat/reader`) renders the same FORMAT.md source to sanitized HTML without CodeMirror or React. It is the lighter read-only version for static pages, issue bodies, review panes, search snippets, server-side rendering, and host-built preview panels.

Both surfaces share the parser, document classes, math/citation/reference semantics, and `DocumentContext` resolver contract. Hosts should use the editor where users need to edit and the reader where they only need to display Coflat content.

The reader output includes resolved reference markup and stable `data-ref-key`
attributes. Hosts that want interactive reading can opt into reader hover cards
with `hydrateReaderHoverPreviews`; that helper uses the same tooltip shell,
positioning, cache behavior, and CSS classes as the editor hover cards while
leaving `renderToHtml` static and server-render friendly.

## Frontmatter

YAML block delimited by `---`. All fields optional.

Coflat follows Quarto's scholarly-article metadata names where they fit. Use
`author` as the canonical author key for new documents; `authors` is accepted
as a compatibility alias. Likewise, top-level `affiliation` and
`affiliations` are aliases, with `affiliations` preferred when defining shared
affiliation records.

```yaml
---
title: Document Title
subtitle: Optional subtitle
description: |
  Short summary for listings, previews, and citation metadata.
date: 2026-06-20
date-format: long

author:
  - id: first
    name: First Author
    email: first@example.org
    orcid: 0000-0000-0000-0000
    url: https://example.org/first
    affiliation:
      - ref: lab
    funding: Supported by grant X.
affiliations:
  - id: lab
    name: Example Lab
    city: Example City
    country: Example Country
    url: https://example.org/lab

doi: 10.5555/example
citation:
  type: article-journal
  container-title: Journal of Examples
  volume: 1
  issue: 2
  doi: 10.5555/example
google-scholar: true
bibliography: reference.bib
csl: style.csl
keywords:
  - keyword one
  - keyword two
license:
  text: CC BY 4.0
  type: open-access
  url: https://creativecommons.org/licenses/by/4.0/
copyright:
  holder: First Author and coauthors
  year: 2026
funding: Document-level funding statement.
acknowledgements: We thank the reviewers.
relatedversion: https://arxiv.org/abs/0000.00000

numbering: global
imageFolder: images
math:
  \R: "\\mathbb{R}"
  \N: "\\mathbb{N}"
latex:
  template: article
  bibliography: reference.bib
blocks:
  claim:
    title: Claim
    counter: theorem
---
```

Put the scholarly abstract in the document body as a normal Coflat block:

```markdown
::: {.abstract}
Scholarly abstract. Markdown, citations, and math like $x^2$ are allowed.
:::
```

### Article metadata

These keys describe the article itself. They are intentionally close to
Quarto's front matter so source can move between Quarto and Coflat with minimal
rewriting.

| Key | Type | Description |
|-----|------|-------------|
| `title` | string | Document title. Rendered by the built-in reader/editor title shell. |
| `subtitle` | string | Optional subtitle for title-block/export hosts. |
| `description` | string | Short summary for listings, previews, and citation metadata. |
| `date` | string | Publication or document date. ISO `YYYY-MM-DD` is preferred; Quarto-style `today`, `now`, and `last-modified` are accepted by hosts that can resolve them. |
| `date-format` | string | Quarto-compatible date formatting hint. |
| `author` / `authors` | string, object, or list | Author metadata. `author` is canonical; `authors` is an accepted alias for existing Coflat/LIPIcs documents. |
| `affiliations` / `affiliation` | string, object, or list | Shared affiliation records. Use `id` and author-side `ref` to avoid repeating shared affiliations. |
| `doi` | string | Article DOI. Also used as a default for `citation.doi` when citation metadata is emitted. |
| `keywords` | list of string | Keyword list. |
| `license` | string or map | License text or `{text, type, url}` metadata. |
| `copyright` | string or map | Copyright statement or `{statement, holder, year}` metadata. |
| `funding` | string | Document-level funding statement. |
| `acknowledgements` | string | Document-level acknowledgements. |
| `relatedversion` | string | Preprint, full version, artifact, or related-version pointer. |
| `citation` | boolean or map | CSL-shaped citation metadata. `true` requests citation metadata from the article fields; a map can provide CSL fields such as `type`, `container-title`, `volume`, `issue`, `publisher`, `url`, `doi`, `page-first`, and `page-last`. |
| `google-scholar` | boolean | Request Google Scholar / Highwire-style metadata in HTML-producing hosts. |

Author objects use Quarto-compatible keys where possible:

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Stable author identifier for references from other metadata. |
| `name` | string or CSL name map | Display name. A CSL name map may be used when particles or family/given names matter. |
| `email`, `phone`, `fax`, `url` | string | Contact details. |
| `orcid` | string | ORCID in `0000-0000-0000-0000` form. |
| `degrees` | string or list | Academic/professional degrees. |
| `affiliation` | string, object, or list | Inline affiliation(s) or `{ref: id}` references to top-level `affiliations`. |
| `affiliation-url` | string | Shortcut URL for a string affiliation. Prefer full affiliation objects when possible. |
| `note`, `acknowledgements`, `funding` | string | Author-specific notes and support statements. |
| `corresponding` | boolean | Marks the corresponding author. |

Affiliation objects use:

| Key | Type | Description |
|-----|------|-------------|
| `id` | string | Stable affiliation identifier. |
| `ref` | string | Reference to another affiliation record. |
| `name` | string | Institution, organization, or lab name. |
| `department`, `group` | string | Optional sub-organization labels. |
| `city`, `state`, `country` | string | Location metadata. |
| `url` | string | Affiliation URL. |

### Coflat document config

These keys control Coflat parsing, rendering, and export behavior rather than
the scholarly identity of the article:

| Key | Type | Description |
|-----|------|-------------|
| `bibliography` | string | Path to `.bib` file (relative to document). |
| `csl` | string | Path to CSL style file. |
| `numbering` | `"global"` \| `"grouped"` | Block numbering scheme. `global`: all numbered blocks share one counter. `grouped`: each type has its own. |
| `math` | map | KaTeX macro definitions (`\command: "expansion"`). |
| `latex` | map | LaTeX export options. Supported keys: `template`, `bibliography`, `csl`. |
| `blocks` | map | Custom block definitions and overrides (`title`, `numbered`, `counter`, enable/disable). |
| `imageFolder` | string | Default folder for pasted/dropped images. Also accepts `image-folder`. |

Project-level config in `coflat.yaml` uses the same Coflat document config
keys. File frontmatter overrides project config. Math macros and block
definitions merge additively (file adds to or overrides project).

### Title-block metadata

The built-in reader/editor presentation currently renders a title-only shell
from `title`. Full-document reader/export hosts that render a richer article
title block should use `title`, `subtitle`, `author`, `date`, `doi`,
and `description`. The following Quarto-compatible keys customize
title-block display when a host supports them:

| Key | Type | Description |
|-----|------|-------------|
| `title-block-style` | `"default"` \| `"plain"` \| `"none"` | Controls title-block processing/styling. |
| `title-block-banner` | boolean or string | Enables a banner title block; a string is interpreted as a banner image path. |
| `title-block-banner-color` | string | Foreground color for banner text. |
| `author-title`, `affiliation-title`, `description-title`, `published-title`, `doi-title` | string | Label overrides for title-block metadata. |

### Template-specific metadata

Fields consumed only by a specific export template remain allowed at top level
so Pandoc templates can read them directly. They should not replace the
article metadata above.

| Key | Type | Description |
|-----|------|-------------|
| `titlerunning` | string | Short title for running heads. |
| `authorrunning` | string | Short author line for running heads. |
| `category` | string | Track / session label. |
| `ccsdesc` | list of `{weight, text}` | ACM CCS subject descriptors (higher weight -> more prominent). |

## Text Formatting

| Syntax | Renders as |
|--------|-----------|
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | `code` (monospace) |
| `~~strikethrough~~` | ~~strikethrough~~ |
| `==highlight==` | highlighted text (Pandoc `mark` extension) |
| `[text](url)` | hyperlink |
| `![alt](src)` | image |

Backtick-quoted text (`` `...` ``) renders as plain monospace — no background or badge. In mathematical writing this corresponds to `\texttt{}` in LaTeX: a font switch, not a code block. The same syntax can mean either "inline code" or "monospace emphasis" depending on context; Coflat does not distinguish between them.

## Paragraphs and Line Breaks

A blank line starts a new paragraph.

A single source newline inside a paragraph is preserved visually by Coflat's
reader and editor surfaces, but remains a Pandoc soft break for export:

```markdown
first visual line
second visual line
```

Do not add manual newlines just to wrap prose in source control. In Coflat those
newlines affect reader/editor presentation and can create unintended ragged line
breaks. Write ordinary prose as one paragraph and let the editor, reader,
browser, or export target wrap it naturally. Pandoc, LaTeX, and ordinary HTML
export treat a soft line break as normal whitespace unless an explicit hard
break is used.

Use an intentional source newline only when the visual break matters in Coflat's
reader/editor presentation. Use a blank line for a new paragraph. Outside
tables, use Markdown's hard line break syntax, two trailing spaces before the
newline, only when the exported target must receive a hard break. For table-cell
line breaks, use the table-cell rule below.

## Headings

ATX headings (`#` through `######`). Auto-numbered unless marked unnumbered. Explicit heading IDs are supported via trailing Pandoc attributes and can be cross-referenced.

```markdown
# Numbered Heading              --> "1. Numbered Heading"
## Subsection                   --> "1.1. Subsection"
# Another Section               --> "2. Another Section"

# Unnumbered Heading {-}        --> no number
## Also Unnumbered {.unnumbered} --> no number
## Background {#sec:background} --> cross-ref target "Section 1.1"
```

Appendices start at a top-level semantic appendix boundary:

```markdown
# Main Result                    --> "1. Main Result"

# Appendix {.appendix}           --> no number; starts appendix mode after this heading

# Extra Proofs                   --> "A. Extra Proofs"
## Technical Lemma               --> "A.1. Technical Lemma"
# Data Tables                    --> "B. Data Tables"
```

The `.appendix` marker is meaningful only on top-level `#` headings. The marker
heading itself is unnumbered, the marker is stripped from visible text, and all
following numbered headings use appendix letters (`A`, `B`, ...) with dotted
subheading numbers (`A.1`, `A.2`, ...). If the first numbered heading after the
boundary is a subheading, it is treated as part of implicit appendix `A` (for
example, `## Proofs` becomes `A.1`). Explicitly unnumbered headings after the
boundary remain unnumbered. LaTeX/PDF export emits `\appendix` at this boundary.

Trailing Pandoc attribute blocks are supported on headings. Coflat uses them primarily for `#id`, `{-}`, `{.unnumbered}`, and `{.appendix}`.

## Math

Four delimiter styles, all producing the same KaTeX output:

### Inline math

```
$e^{i\pi} + 1 = 0$
\(e^{i\pi} + 1 = 0\)
```

### Display math

```
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$

\[
\sum_{k=0}^n \binom{n}{k} = 2^n
\]
```

Display math can interrupt a paragraph (no blank line required before `$$` or `\[`).

### Labeled equations

Unlabeled display math uses `$$...$$` or `\[...\]`. Labeled equations use the pandoc-crossref display-math label convention:

```markdown
$$
E = mc^2
$$ {#eq:einstein}
```

The label must use the `eq:` prefix. Pandoc core parses `{#eq:einstein}` as ordinary text after the math block; Coflat treats this as canonical because pandoc-crossref recognizes it and resolves `[@eq:einstein]` when the filter runs before citeproc. Raw LaTeX `\begin{equation}\label{eq:...}...\end{equation}` is allowed as raw TeX, but it is not the canonical Coflat equation-label syntax.

Equation labels must be unique within a document. Duplicate `{#eq:id}` labels are accepted by the parser but flagged by the semantic index; cross-references to the duplicated id resolve as ambiguous.

**Escape rules.** A literal dollar sign in prose is written `\$` and does not open inline math. Inside `$...$` inline math, a backslash escapes the following character, so `$ \$50 $` is a math span containing a literal `$`. Display math `\[...\]` and inline math `\(...\)` are the LaTeX-style alternative syntaxes for `$$...$$` and `$...$`; the same backslash-escape applies to their contents. Dollar-math is suppressed inside fenced code blocks and inline code spans.

### Custom macros

Define in frontmatter under `math:`. Available in all math expressions:

```yaml
math:
  \R: "\\mathbb{R}"
  \set: "\\left\\{#1\\right\\}"
```

Usage: `$x \in \R$`, `$\set{1,2,3}$`.

## Fenced Divs

Pandoc-style fenced divs for semantic blocks. Minimum 3 colons.

### Basic syntax

```markdown
::: {.theorem}
Content here.
:::
```

### With ID, class, and title

```markdown
::: {.theorem #thm:main title="Main Result"}
Statement of the theorem with $math$.
:::
```

The title is a Pandoc attribute. It is plain text, not inline markdown. For standard above-header blocks, the title appears parenthesized after the block label: **Theorem 1** (Main Result). For `figure`, `table`, and `algorithm` blocks, the title becomes the caption.

Attributes inside `{...}`:
- `.classname` -- block type (required, first class is the primary type)
- `#id` -- cross-reference ID
- `key="value"` -- key-value attributes (e.g., `title="Alternative Title"`)
- Multiple classes: `{.theorem .important}` (first is the block type)

Trailing title text after the attribute block, such as `::: {.theorem} Main Result`, is not canonical because Pandoc does not parse it as part of the div.

### Class shorthand

Pandoc supports a class-only shorthand when no ID or title is needed:

```markdown
::: theorem
Content.
:::
```

This is equivalent to `::: {.theorem}`. It cannot carry a title.

### No self-closing blocks

Fenced divs must use explicit opener and closer lines:

```markdown
::: {.theorem}
Short statement.
:::
```

Single-line self-closing divs such as `::: {.theorem} Short statement. :::` are not canonical because Pandoc treats them as unclosed divs or literal paragraph text.

Unclosed fenced divs at end of file are tolerated while editing and during import recovery, but they are not canonical. A saved canonical document must include the matching closing fence line.

### Nesting

Use more colons for outer divs:

```markdown
:::: {.theorem title="Outer result"}
Statement.

::: {.proof}
Proof content.
:::
::::
```

The opening and closing fence of a single div must use the same number of colons. A closer with a different colon count is not a valid match for that opener.

The inner block must use **fewer** colons than the outer. Each level of nesting must use a strictly smaller colon count than the level enclosing it; reusing the same count at any nested level is not supported.

Same-colon nesting is not supported. For example, this is invalid and will parse incorrectly:

```markdown
::: {.theorem}
::: {.proof}
...
:::
:::
```

Use `::::` for the outer block and `:::` for the inner block instead.

The parser uses a generation counter to prevent incremental fragment reuse across composite block boundaries.

Display math and fenced divs are independent block structures. A display math opener inside a fenced div must close before the fenced div closes; otherwise the fenced div closer still wins as the block boundary and the math is treated as incomplete authoring state.

### Built-in block types

| Type | Counter group | Body style | Special behavior |
|------|--------------|-----------|-----------------|
| `theorem` | theorem | italic | -- |
| `lemma` | theorem | italic | -- |
| `corollary` | theorem | italic | -- |
| `proposition` | theorem | italic | -- |
| `conjecture` | theorem | italic | -- |
| `definition` | definition | normal | -- |
| `problem` | theorem | normal | -- |
| `example` | -- (unnumbered) | normal | -- |
| `remark` | -- (unnumbered) | normal | -- |
| `proof` | -- (unnumbered) | normal | QED tombstone at end |
| `algorithm` | algorithm | normal | -- |
| `figure` | figure | normal | caption rendered below content |
| `table` | table | normal | caption rendered below content |
| `blockquote` | -- (unnumbered) | normal | header label hidden |

Counter groups: blocks sharing a counter group are numbered together. E.g., Theorem 1, Lemma 2, Corollary 3 all share the "theorem" counter.

Typical numbered figure/table usage:

```markdown
::: {.figure #fig:architecture title="System overview"}
![System overview](architecture.png)
:::

::: {.table #tbl:runtime title="Running times"}
| Algorithm | Time |
|-----------|------|
| Quicksort | $O(n \log n)$ |
:::
```

#### Multi-image figures (subfigures)

A figure div may contain more than one image. Each image becomes a subfigure in LaTeX (`\subfigure` / `\subcaptionbox`). Alt text per image is used as the subcaption:

```markdown
::: {.figure #fig:compare title="Before and after"}
![Before](before.png)
![After](after.png)
:::
```

#### Algorithm body

Algorithm blocks use a fenced code block (language `text` or none) for the pseudocode body. The exporter lifts the body verbatim into a LaTeX `algorithm` environment; the div's `title` attribute becomes the `\caption`:

````markdown
::: {.algorithm #alg:dijkstra title="Shortest paths"}
```text
Input: graph G, source s
Output: distances d[v]
  for each v in V: d[v] <- infinity
  d[s] <- 0
  ...
```
:::
````

### Custom block types

Define in frontmatter:

```yaml
blocks:
  claim:
    title: Claim
    counter: theorem    # share counter with theorem family
  axiom:
    title: Axiom
    counter: axiom      # own counter group
```

`blocks:` entries can be:
- `false` -- disable a built-in block type for this document
- `true` -- explicitly enable an existing block type
- an object with:
  - `title` -- override the rendered label
  - `numbered` -- enable/disable numbering for that block type
  - `counter` -- shared counter group name
  - `counter: null` -- remove an inherited shared group and use the block's own counter

## Cross-References

Reference fenced blocks and headings by their `#id` attribute. Reference labeled equations by their pandoc-crossref `{#eq:...}` display-math label.

> **Parser vs. semantics scope.** `[@id]` and `@id` are not tokenized by Coflat's markdown parser; they appear in the syntax tree as ordinary text (matching Pandoc core, which leaves them for `pandoc-crossref` and `citeproc` to resolve). The reference index, renderer, and LaTeX exporter recognize and resolve them as a downstream semantic pass. Tooling that needs to highlight or rewrite these tokens should run against the semantic index, not the parse tree.

### ID prefixes

IDs are conventionally prefixed by target kind. The LaTeX exporter uses these prefixes to route `[@id]` to `\cref{id}` vs `\cite{id}`:

| Prefix | Target |
|--------|--------|
| `sec:` | heading |
| `thm:` | theorem |
| `lem:` | lemma |
| `cor:` | corollary |
| `prop:` | proposition |
| `def:` | definition |
| `eq:` | equation |
| `fig:` | figure |
| `tbl:` | table |
| `alg:` | algorithm |

Any other bare key (e.g. `karger2000`) is treated as a citation key. IDs with unrecognized prefixes still resolve if they match a fenced block `#id`.

### Bracketed (rendered inline)

```markdown
See [@thm:main] for the proof.     --> "See Theorem 1 for the proof."
By [@eq:einstein], energy is...     --> "By Eq. (1), energy is..."
See [@sec:background].             --> "See Section 1.1."
```

### Narrative (bare @)

```markdown
@thm:main shows that...             --> "Theorem 1 shows that..."
```

### Clusters

Multiple references can be clustered with `;`. Each item is resolved independently, so mixed cross-reference/citation clusters are supported:

```markdown
[@thm:main; @eq:einstein]
[@eq:einstein; @karger2000]
```

Resolution order: fenced blocks (by fenced div `#id`) -> equations (by display-math `{#eq:id}`) -> headings (by heading `#id`) -> citations (by bib key). If an ID matches a fenced block, it takes priority over a citation with the same key.

### Live preview example

:::: {.theorem #thm:format-live title="Shared preview surfaces"}
The editor and reader can both show hover previews for the same FORMAT.md
references.
::::

$$
E = mc^2
$$ {#eq:format-live}

Live reader/editor preview example: [@thm:format-live] and [@eq:format-live].

## Citations

Require a `.bib` file specified in frontmatter `bibliography:` or project `coflat.yaml`.

### Parenthetical

```markdown
See [@karger2000] for details.
Results from [@karger2000; @stein2001].
```

### With locators

```markdown
[@karger2000, p. 42]
[@karger2000, Theorem 3; @stein2001, Ch. 2]
```

### Narrative

```markdown
@karger2000 showed that...          --> "Karger (2000) showed that..."
```

Citation formatting depends on the CSL style. Default: IEEE numeric (`[1]`, `[2]`). A bibliography section is automatically appended at the end of the document listing all cited entries.

## Footnotes

```markdown
This has a footnote[^1].

[^1]: This is the footnote content with math $x^2$.
```

Footnote IDs can be any string: `[^note]`, `[^long-id]`. Rendered as sidenotes in the margin when space allows. Footnote definitions can appear anywhere in the document.

## Code Blocks

Fenced code blocks only. **Indented code blocks are disabled** (4-space indent is cosmetic only, does not create a code block).

````markdown
```haskell
fibonacci :: Int -> Int
fibonacci 0 = 0
fibonacci n = fibonacci (n-1) + fibonacci (n-2)
```
````

Language tag after opening fence enables syntax highlighting.

## Tables

Pipe-delimited tables with optional alignment:

```markdown
| Algorithm | Time          | Space       |
|-----------|---------------|-------------|
| Quicksort | $O(n \log n)$ | $O(\log n)$ |
| Mergesort | $O(n \log n)$ | $O(n)$      |
```

Alignment: `|:---|` left, `|:---:|` center, `|---:|` right. Math works inside table cells.

### Line breaks inside cells

Inline `<br>` forces a visible line break inside a cell. The LaTeX exporter maps `<br>` in a cell to `\newline` (within a `tabularx` column).

```markdown
| Case | Notes |
|------|-------|
| A    | first line<br>second line |
```

### Grid tables

Grid tables (pandoc `grid_tables`) are accepted as Pandoc-compatible raw/source blocks for cells that need multiple paragraphs or block content. Coflat preserves the grid-table source range for import/export and source-boundary operations, but grid tables are not parsed into Coflat's semantic live table model. Use pipe tables for editable semantic tables.

```markdown
+-------+------------------+
| Input | Output           |
+=======+==================+
| graph | first paragraph  |
|       |                  |
|       | second paragraph |
+-------+------------------+
```

## Lists

Ordered, unordered, and task lists. Math works inside list items:

```markdown
1. First item with $O(n \log n)$
2. Display math in list:
   $$
   T(n) = 2T(n/2) + O(n)
   $$

- Bullet with macros: $\R$, $\N$, $\Z$
- [ ] Unchecked task
- [x] Checked task
```

## Removed Features

These standard markdown features are **not canonical**, even if Pandoc's markdown reader can parse some of them:

| Feature | Reason | Alternative |
|---------|--------|-------------|
| Indented code blocks | Conflicts with fenced div content indentation | Use fenced code blocks |
| `>` blockquotes | Limited (no math, no nesting with fenced divs) | Use `::: {.blockquote}` fenced divs |
| Pandoc definition lists (`Term` followed by `: Definition`) | Not part of the Coflat semantic model | Use `::: {.definition}` fenced divs for mathematical definitions, or ordinary lists/tables for glossaries |
| Raw inline HTML (`<br>`, `<sub>`, `<sup>`, etc.) | Coflat's reader does not enable Pandoc's `+raw_html`; rendering pure-Pandoc markdown only | Use `\\` for line breaks in math; use raw LaTeX (`\textsubscript{...}`) for sub/superscript outside math |
| HTML comments (`<!-- ... -->`) | Not part of the canonical Coflat surface; not hidden in render | Strip before authoring, or use a `::: {.remark}` block |
| Reference-style links (`[text][id]` with `[id]: url` definitions) | Authors should use inline `[text](url)` form to keep one source location per link | Inline links `[text](url)` |
| Bare URL autolink (`https://example.com` without brackets) | Pandoc's `+autolink_bare_uris` is not enabled | Wrap in `[https://example.com](https://example.com)` or `<https://example.com>` |

The read/export pipeline still parses standard `>` blockquotes for compatibility with imported markdown, but the editor authoring format does not use them.

## Horizontal Rules

```markdown
---
```

Three or more hyphens on a line. Must not be at the start of the document (where `---` is frontmatter). A blank line before `---` distinguishes it from frontmatter.

## LaTeX Export

The LaTeX export pipeline (`scripts/export-latex.mjs`, desktop PDF/LaTeX export, `src/latex/`) emits a compilable `.tex` or `.pdf` file from a canonical Coflat Markdown document. The stages are:

1. **Prepare metadata** — preserve root frontmatter as Pandoc metadata and hoist supported export-only fields such as `math:` into Pandoc-compatible metadata.
2. **Pandoc** — invoked as:

   ```text
   pandoc --from markdown+fenced_divs+raw_tex+grid_tables+pipe_tables+tex_math_dollars+tex_math_single_backslash+mark \
          --to latex --wrap=preserve --syntax-highlighting=none \
          --lua-filter=src/latex/filter.lua \
          --template=src/latex/template/<variant>.tex \
          --metadata=bibliography=<bib-name-without-.bib> \
          --output=out/<doc>.tex
   ```

3. **Compile** — `latexmk -pdf out/<doc>.tex` (optional; separate target).

### Block vocabulary mapping

Each built-in block maps to a LaTeX environment. Unknown classes are passed through as raw text.

| Fenced div class | LaTeX environment | Notes |
|------------------|-------------------|-------|
| `.theorem` | `theorem` | |
| `.lemma` | `lemma` | |
| `.corollary` | `corollary` | |
| `.proposition` | `proposition` | |
| `.conjecture` | `conjecture` | Requires `\newtheorem{conjecture}` |
| `.definition` | `definition` | |
| `.problem` | `problem` | |
| `.example` | `example` | |
| `.remark` | `remark` | |
| `.proof` | `proof` | |
| `.algorithm` | `algorithm` | Body becomes pseudocode; title → `\caption`, `#id` → `\label` |
| `.figure` | `figure` | Multi-image → subfigures |
| `.table` | `table` + `tabularx` | Supports `<br>` → `\newline`, grid tables → multi-paragraph cells |
| `.blockquote` | `quote` | |

### Inline mapping

| Coflat markdown | LaTeX |
|-----------------|-------|
| `$...$` | `\(...\)` |
| `\(...\)` | `\(...\)` (passthrough) |
| `$$...$$` (unlabeled) | `\[...\]` |
| `$$...$$ {#eq:id}` | labeled equation via pandoc-crossref |
| `==highlight==` | `\hl{highlight}` (requires `\usepackage{soul}`) |
| `[@id]` where `id` begins with an xref prefix | `\cref{id}` |
| `[@id]` otherwise | `\cite{id}` |
| `@id` where `id` begins with an xref prefix | `\cref{id}` (narrative form) |
| `- [ ] task` / `- [x] done` | `\item[$\square$]` / `\item[$\boxtimes$]` inside `itemize` |
| `<br>` inside a table cell | `\newline` |
| `<br>` outside a table | `\\` |

### Math macro injection

Frontmatter `math:` entries become `\newcommand` declarations in the preamble. The exporter detects argument arity by scanning the RHS for `#1`, `#2`, ...:

```yaml
math:
  R: "\\mathbb{R}"
  floor: "\\lfloor #1 \\rfloor"
```

→

```latex
\newcommand{\R}{\mathbb{R}}
\newcommand{\floor}[1]{\lfloor #1 \rfloor}
```

The LaTeX importer recognizes the same exported `\newcommand` shape, plus
`\renewcommand`, `\def`, `\let`, and `\DeclareMathOperator`, and maps used
macros back into frontmatter `math:`.

### Template variants

- `template/article.tex` — plain `\documentclass{article}` fallback with `amsthm`, `cleveref`, `soul`, `tabularx`, `booktabs`, `algorithm`, `hyperref`.
- `template/lipics.tex` — LIPIcs submissions; consumes article metadata plus LIPIcs-specific template metadata (`author`/`authors`, `ccsdesc`, `keywords`, `copyright`, `titlerunning`, `authorrunning`, `funding`, `acknowledgements`, `category`, `relatedversion`).

Select a variant with `scripts/export-latex.mjs --template lipics` or by setting `latex.template: lipics` in frontmatter. `latex.bibliography` overrides the top-level `bibliography` value for LaTeX export; command-line `--template` and `--bibliography` flags override frontmatter in the CLI.
