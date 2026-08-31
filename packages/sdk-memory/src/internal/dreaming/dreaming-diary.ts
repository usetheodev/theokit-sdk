/**
 * The dreaming diary — re-exported from `@theokit/sdk`, not reimplemented here.
 *
 * This was a copy: 39 lines across `diaryPath`, `renderDiaryEntry`, `entryHash` and
 * `appendDiaryEntry`, with zero diverging from the SDK's. `Memory.runDreamingSweep` routes through
 * this package whenever it is installed, so a copy here is a second thing that has to be kept
 * right, and the record of this package pair is that the copy is the one nobody updates (#430).
 */
export {
  appendDiaryEntry,
  type DiaryEntry,
  diaryPath,
  entryHash,
  renderDiaryEntry,
} from "@theokit/sdk/internal/memory-store";
