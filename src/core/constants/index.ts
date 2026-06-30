/**
 * Barrel file for centralized constants.
 *
 * Re-exports block manifest, CSS class names, Lezer node types,
 * timing limits, layout dimensions, DOM event names, and storage keys.
 */

export {
  ALGORITHM_COUNTER,
  BLOCK_MANIFEST,
  type BlockManifestEntry,
  type BlockName,
  type BodyStyle,
  COUNTER_GROUPS,
  DEFINITION_COUNTER,
  EXCLUDED_FROM_FALLBACK,
  type SpecialBehavior,
  STYLED_BLOCK_NAMES,
  THEOREM_COUNTER,
} from "./block-manifest";

export { CSS } from "./css-classes";
export {
  FORMAT_EVENT,
  MODE_CHANGE_EVENT,
  PERF_PANEL_REFRESH_EVENT,
  PERF_PANEL_TOGGLE_EVENT,
} from "./events";
export {
  CONTENT_MAX_WIDTH,
  IMAGE_MAX_HEIGHT,
  SIDENOTE_MARGIN_WIDTH,
  SIDENOTE_OFFSET,
  SIDENOTE_WIDTH,
} from "./layout";
export { NODE, type NodeTypeName } from "./node-types";
export {
  RECENT_FILES_KEY,
  RECENT_FOLDERS_KEY,
  SETTINGS_KEY,
  WINDOW_STATE_KEY,
} from "./storage-keys";
export {
  COPY_RESET_MS,
  HOVER_DELAY_MS,
  IMAGE_TIMEOUT_MS,
  MAX_PERF_OPERATIONS,
  MAX_PERF_RECORDS,
  READING_WPM,
  SEARCH_CONTEXT_BUFFER,
} from "./timing";
