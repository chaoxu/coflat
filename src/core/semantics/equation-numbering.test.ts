import { describe, expect, it } from "vitest";

import {
  initialEquationNumberCounter,
  nextEquationNumber,
} from "./equation-numbering";

describe("equation numbering", () => {
  it("assigns one-based numbers in document order", () => {
    let counter = initialEquationNumberCounter();
    const numbers: number[] = [];

    for (let i = 0; i < 3; i++) {
      const result = nextEquationNumber(counter);
      counter = result.counter;
      numbers.push(result.number);
    }

    expect(numbers).toEqual([1, 2, 3]);
    expect(counter).toBe(3);
  });

  it("leaves previous counter snapshots unchanged", () => {
    const counter = initialEquationNumberCounter();
    const first = nextEquationNumber(counter);
    const second = nextEquationNumber(first.counter);

    expect(counter).toBe(0);
    expect(first).toEqual({ counter: 1, number: 1 });
    expect(second).toEqual({ counter: 2, number: 2 });
  });
});
