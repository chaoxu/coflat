export const PARITY_SOURCE_KEY = "__coflatParitySource";

export const DEFAULT_PARITY_SOURCE = `# Default Document

This paragraph includes **bold text**, *italic text*, ~~struck text~~,
==highlighted text==, \`inline code\`, $x + y$, and a
[reference link](https://example.com).

References should align too: [@karger2000]
and [@external-page].

## Main Result

### Supporting Lemma $a + b$

- unordered item with $u + v$
- [x] completed task

3. ordered item

> Standard blockquotes should render through the same document surface.
>
> They can include **bold text**, $q$, and [a link](https://quote.example).

| Name | Value |
| --- | ---: |
| Alpha | 1 |

\`\`\`ts
const value = 1;
\`\`\`

$$
x^2 + y^2 = z^2
$$

::: {.definition #def-theme title="Scoped theme"}
A default theme is applied by the host on the nearest scoped root.
:::

::: {.theorem #main-result title="Readable column"}
Every optimal document theme has a readable column, $r$, and stable theorem rails.
:::

::: {.proof title="the readable column theorem"}
The host applies a scoped class, and Coflat surfaces inherit variables from $s$.
:::

::: {.blockquote}
Quoted document surfaces should share blockquote styling.
:::
`;
