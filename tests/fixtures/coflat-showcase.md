# Coflat Showcase

This document is the package smoke fixture for reader and editor visual checks.

## Numbered Section

The reader should match the editor's full document rhythm for paragraphs,
lists, code, tables, math, and theorem-like blocks.

- visible unordered marker
- `inline code`
- math placeholder $x^2 + y^2 = z^2$

```ts
const answer = 42;
```

| name | value |
| --- | ---: |
| alpha | 1 |

::: {.theorem title="Pythagoras"}
For a right triangle, $a^2 + b^2 = c^2$.
:::

## Unnumbered Section {.unnumbered}

Pandoc heading attributes should not be visible.

# Appendix {-}

This heading is also unnumbered.
