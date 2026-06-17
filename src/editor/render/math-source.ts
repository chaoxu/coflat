import type { SelectionRange } from "@codemirror/state";
import type { EquationSemantics, MathSemantics } from "../semantics/document";
export {
  DISPLAY_DELIMITERS,
  INLINE_DELIMITERS,
  getDisplayMathContentEnd,
  stripMathDelimiters,
} from "../../core/math-source";

export const MATH_TYPES = new Set(["InlineMath", "DisplayMath"]);

/**
 * Snap an absolute document position to the nearest LaTeX token boundary
 * so the cursor doesn't land mid-command (for example inside `\alpha`).
 */
export function _snapToTokenBoundary(
  latex: string,
  contentFrom: number,
  absPos: number,
): number {
  const rel = absPos - contentFrom;
  const starts: number[] = [];
  let i = 0;
  while (i < latex.length) {
    starts.push(i);
    if (latex[i] === "\\") {
      i++;
      if (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
        while (i < latex.length && /[a-zA-Z]/.test(latex[i])) i++;
      } else if (i < latex.length) {
        i++;
      }
    } else {
      i++;
    }
  }
  starts.push(latex.length);

  let best = starts[0];
  let bestDist = Math.abs(rel - best);
  for (let j = 1; j < starts.length; j++) {
    const dist = Math.abs(rel - starts[j]);
    if (dist < bestDist) {
      best = starts[j];
      bestDist = dist;
    } else {
      break;
    }
  }
  return contentFrom + best;
}

function findMathRegionCandidate(
  regions: readonly MathSemantics[],
  pos: number,
): MathSemantics | undefined {
  let lo = 0;
  let hi = regions.length - 1;
  let candidate: MathSemantics | undefined;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid];
    if (region.from <= pos) {
      candidate = region;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return candidate;
}

export function findMathRegionAtPos(
  regions: readonly MathSemantics[],
  pos: number,
): MathSemantics | undefined {
  const candidate = findMathRegionCandidate(regions, pos);
  return candidate && pos <= candidate.to ? candidate : undefined;
}

/**
 * Binary-search the sorted math regions for the one containing the selection.
 */
export function findActiveMath(
  regions: readonly MathSemantics[],
  selection: SelectionRange,
): MathSemantics | undefined {
  const candidate = findMathRegionCandidate(regions, selection.from);
  return candidate && selection.to <= candidate.to ? candidate : undefined;
}

function buildEquationNumbers(
  equationById: ReadonlyMap<string, EquationSemantics>,
): ReadonlyMap<number, number> {
  const numbers = new Map<number, number>();
  for (const equation of equationById.values()) {
    numbers.set(equation.from, equation.number);
  }
  return numbers;
}

const equationNumbersByFromCache = new WeakMap<
  ReadonlyMap<string, EquationSemantics>,
  ReadonlyMap<number, number>
>();

export function buildEquationNumbersByFrom(
  equationById: ReadonlyMap<string, EquationSemantics>,
): ReadonlyMap<number, number> {
  const cached = equationNumbersByFromCache.get(equationById);
  if (cached) return cached;

  const numbers = buildEquationNumbers(equationById);
  equationNumbersByFromCache.set(equationById, numbers);
  return numbers;
}

export function getDisplayEquationNumber(
  region: MathSemantics,
  equationNumbersByFrom: ReadonlyMap<number, number>,
): number | undefined {
  if (!region.isDisplay || region.labelFrom === undefined) return undefined;
  return equationNumbersByFrom.get(region.from);
}
