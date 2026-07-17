/**
 * Test-only preload for the workbench editor plugins that `createEditor`
 * loads after mount via dynamic `import()` (see editor-plugin-presets.ts).
 *
 * Without this, a test file that mounts an editor and finishes quickly can
 * leave those imports in flight; they then resolve after vitest tears down
 * the jsdom environment and fail with "Cannot load ... after the environment
 * was torn down" (observed with block-type-picker -> react-dom). Importing
 * the modules statically here puts them in the file's module registry, so
 * the runtime `import()` is a synchronous cache hit.
 *
 * Import this (side effect only) from any test file that calls
 * `createEditor` with the default workbench plugin preset.
 */
import "./block-type-picker";
import "./fence-language-autocomplete";
import "./find-replace";
import "./reference-autocomplete";
