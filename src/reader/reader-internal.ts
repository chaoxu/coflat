/**
 * Internal hooks for the reader. Not part of the public API surface.
 *
 * Only imported by `reader.ts` and `reader-render.test.ts`. Kept out of
 * the `./reader` barrel so it never lands in `dist/reader.d.ts`.
 */

let lezerInvocationCount = 0;

export function noteLezerInvocation(): void {
  lezerInvocationCount++;
}

export function getLezerInvocationCount(): number {
  return lezerInvocationCount;
}

export function resetLezerInvocationCount(): void {
  lezerInvocationCount = 0;
}
