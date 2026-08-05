/**
 * `@theokit/sdk/interactive` — pluggable interactive-session backend seam.
 *
 * The streaming twin of `@theokit/sdk/sandbox` (one-shot `execute`) and sibling
 * of `@theokit/sdk/filesystem`. Ship an `InteractiveBackend` (e.g. the local
 * `@theokit/sdk-pty`, a container/E2B backend for the cluster, or a Tauri
 * backend) to give agent shell tools a surface-agnostic REPL/stdin capability —
 * with NO native dependency in core.
 *
 * @public
 */

export {
  InteractiveBackend,
  type InteractiveProvider,
  InteractiveUnavailableError,
  NoSuchSessionError,
  resolveInteractive,
  type StartInteractiveOptions,
  type StartInteractiveResult,
  type WriteStdinOptions,
  type WriteStdinResult,
} from "./types.js";
