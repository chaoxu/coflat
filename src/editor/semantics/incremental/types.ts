export interface RawChangedRange {
  readonly fromOld: number;
  readonly toOld: number;
  readonly fromNew: number;
  readonly toNew: number;
}

export interface DirtyWindow {
  readonly fromOld: number;
  readonly toOld: number;
  readonly fromNew: number;
  readonly toNew: number;
}

export interface SemanticDelta {
  readonly rawChangedRanges: readonly RawChangedRange[];
  readonly dirtyWindows: readonly DirtyWindow[];
  readonly docChanged: boolean;
  readonly syntaxTreeChanged: boolean;
  readonly globalInvalidation: boolean;
  readonly plainInlineTextOnlyChange: boolean;
  /**
   * Set on otherwise-empty transactions dispatched by the idle pending-drain
   * driver: asks the engine to consume a bounded chunk of pending regions
   * even though neither the document nor the syntax tree changed.
   */
  readonly pendingDrain?: boolean;
  mapOldToNew(pos: number, assoc?: number): number;
  mapNewToOld(pos: number, assoc?: number): number;
}
