export {
  type BlockCounterState,
  computeBlockNumbers,
  emptyCounterState,
  type NumberedBlock,
} from "./block-counter";
export {
  createBlockRender,
  formatBlockHeader,
} from "./block-render";
export {
  defaultPlugins,
  theoremFamilyPlugins,
} from "./default-plugins";
export {
  fenceOperationAnnotation,
} from "./fence-protection";
export {
  createStandardPlugin,
  pluginFromManifest,
  type StandardPluginOptions,
} from "./plugin-factory";
export {
  applyFrontmatterBlocks,
  createRegistryState,
  getPlugin,
  getPluginOrFallback,
  getRegisteredNames,
  type PluginRegistryState,
  pluginFromConfig,
  registerPlugin,
  registerPlugins,
  unregisterPlugin,
} from "./plugin-registry";
export type {
  BlockAttrs,
  BlockDecorationSpec,
  BlockPlugin,
} from "./plugin-types";
export { QED_SYMBOL } from "./proof-plugin";
