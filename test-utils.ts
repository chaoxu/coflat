/**
 * Top-level entry for @chaoxu/coflat/test-utils.
 *
 * These helpers are intended for downstream Vitest suites. They are kept out
 * of the main editor entry because they import Vitest and test-only DOM setup
 * helpers.
 */
export * from "./src/editor/test-utils.js";
