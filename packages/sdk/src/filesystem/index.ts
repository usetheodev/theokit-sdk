/**
 * `@theokit/sdk/filesystem` — pluggable filesystem provider seam (SE31).
 *
 * The storage-side twin of `@theokit/sdk/sandbox`. Ship a `FilesystemBackend`
 * (default `LocalFilesystem`) to give agent file tools a boundary-enforced,
 * optionally read-only, provider-swappable storage root — including a
 * per-request resolver for multi-tenant roots. See ADR 0011.
 *
 * @public
 */

export { LocalFilesystem } from "./local-filesystem.js";
export {
  FileNotFoundError,
  type FileStat,
  FilesystemBackend,
  type FilesystemConfig,
  FilesystemError,
  type FilesystemProvider,
  FilesystemReadOnlyError,
  FilesystemSecurityError,
  resolveFilesystem,
  StaleFileError,
  type WriteFileOptions,
} from "./types.js";
