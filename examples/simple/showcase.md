# Coflat Showcase

This document demonstrates the default Coflat editor and reader surfaces.

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
| beta | 2 |

::: {.theorem title="Pythagoras"}
For a right triangle, $a^2 + b^2 = c^2$.
:::

::: {.proof}
Square the side lengths and compare the areas.
:::

## Unnumbered Section {.unnumbered}

Pandoc heading attributes should not be visible in rich rendering.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

# Appendix {-}

This heading is also unnumbered.
