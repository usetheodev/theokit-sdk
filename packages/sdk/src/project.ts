/**
 * `@theokit/sdk/project` — hierarchical project-instruction reader/writer.
 *
 * `readProjectInstructions(cwd, options?)` walks up from `cwd` collecting a
 * configurable instruction file (default `THEO.md`), returning the found files
 * nearest-first plus a `scope`-selected `content` (`nearest` | `merged`). It
 * never throws. `writeProjectInstructions(cwd, content, options?)` writes the
 * file atomically (temp + fsync + rename) and fails loud on write errors.
 *
 * Composes the SDK's own hardened `walkUpForFile` discovery + the atomic
 * `replaceFileAtomic` writer — so consumers read/write project instructions
 * with one import instead of hand-rolling the walk-up + atomic write.
 */

export {
  type ProjectInstructionFile,
  type ProjectInstructionScope,
  type ProjectInstructions,
  type ReadProjectInstructionsOptions,
  readProjectInstructions,
  type WriteProjectInstructionsOptions,
  writeProjectInstructions,
} from "./internal/runtime/context/project-instructions.js";
