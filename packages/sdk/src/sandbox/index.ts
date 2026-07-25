// M75 T2.1 — confinamento de kernel promovido do agent-builder. Aditivo: nenhum consumidor existente
// muda, e o subsistema se auto-protege por deteccao em runtime (fallback honesto) em vez de por
// gating de plataforma no build.
export {
  type BwrapArgvOptions,
  type BwrapDetection,
  type BwrapProbes,
  buildBwrapArgv,
  detectBwrap,
  detectBwrapMemoizado,
  realProbeCount,
  realProbes,
  resetBwrapMemo,
  type SandboxMode,
} from "./bwrap.js";
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
