// M75 T2.1 — confinamento de kernel promovido do agent-builder. Aditivo: nenhum consumidor existente
// muda, e o subsistema se auto-protege por deteccao em runtime (fallback honesto) em vez de por
// gating de plataforma no build.
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
} from "./bwrap.js";
// M75 T2.2 — o backend com enforcement de kernel + o wrap + a postura. `wrapCommandForSandbox` e
// `resolveSandboxPosture` sao API PUBLICA por exigencia do M75 (T2.3): a primeira para quem compoe o
// wrap noutro lugar (o PTY interativo), a segunda para a UI responder "estou confinado agora?".
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
