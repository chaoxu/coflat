export {
  type DirtyRange,
  type DirtyRangeExpander,
  dirtyRangesFromChanges,
  expandChangeRange,
  expandChangeRangeToLines,
  mergeDirtyRanges,
  rangeIntersectsDirtyRanges,
} from "../state/incremental-dirty-ranges";
