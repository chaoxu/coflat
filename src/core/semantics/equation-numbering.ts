export type EquationNumberCounter = number;

export interface EquationNumberResult {
  readonly counter: EquationNumberCounter;
  readonly number: number;
}

export function initialEquationNumberCounter(): EquationNumberCounter {
  return 0;
}

export function nextEquationNumber(
  counter: EquationNumberCounter,
): EquationNumberResult {
  const number = counter + 1;
  return { counter: number, number };
}
