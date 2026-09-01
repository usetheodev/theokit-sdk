/**
 * Published as `@theokit/sdk/sandbox`.
 */
// M75 T2.1 — kernel confinement promoted from agent-builder. Additive: no existing consumer
// changes, and the subsystem protects itself by runtime detection (an honest fallback) rather than by
// platform gating at build time.
export {
  type BwrapArgvOptions,
  type BwrapDetection,
  type BwrapProbes,
  buildBwrapArgv,
  detectBwrap,
  detectBwrapMemoized,
  realProbeCount,
  realProbes,
  resetBwrapMemo,
  type SandboxMode,
  writableRootsFor,
} from "./bwrap.js";
// M75 T2.2 — the backend with kernel enforcement + the wrap + the posture. `wrapCommandForSandbox` is
// `resolveSandboxPosture` are PUBLIC API as required by M75 (T2.3): the first for whoever composes the
// wrap elsewhere (the interactive PTY), the second so the UI can answer "am I confined right now?".
export {
  allowlistedEnv,
  type CreateSandboxBackendOptions,
  createSandboxBackend,
  type InteractiveWrapOptions,
  interactiveWrapCommand,
  LinuxSandbox,
  resetInteractiveWarnLatch,
  resetSandboxWarnLatch,
  resolveSandboxPosture,
  restrictedSeccompPath,
  type SandboxPosture,
  seccompPathForArch,
  wrapCommandForSandbox,
} from "./linux-sandbox.js";
export { LocalSandbox } from "./local-sandbox.js";
export {
  type ProvisionRepoOptions,
  provisionRepo,
  RepoProvisionError,
} from "./provision.js";
export { buildSeccompFilter, type SeccompOptions } from "./seccomp.js";
export {
  type ExecuteResult,
  resolveSandbox,
  SandboxBackend,
  type SandboxConfig,
  SandboxNotAvailableError,
  type SandboxProvider,
  SandboxSecurityError,
} from "./types.js";
