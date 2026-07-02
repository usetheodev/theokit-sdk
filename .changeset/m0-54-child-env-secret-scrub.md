---
"@theokit/sdk": patch
---

Stop leaking host secrets into child processes and stop overclaiming sandbox isolation (#54). Every subprocess the SDK spawned (hook scripts via the hooks executor, the shell tool, and `LocalSandbox`) inherited the FULL `process.env`, so API keys, tokens and passwords were exposed to executed commands. A new stdlib env-policy helper (`resolveChildEnv`, modeled on codex's `ShellEnvironmentPolicy`) now scrubs secret-like variable names (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*_AUTH*`) from the child environment by default (`inherit-scrubbed`). Non-secret vars (including `PATH`/`HOME`) are preserved, and an explicit `env` override always wins, so this is non-breaking for legitimate use. Opt out with policy `"all"` or tighten with `"core"` via `SandboxConfig.env`. `LocalSandbox`'s documentation is corrected to state plainly that it provides NO OS/filesystem/network isolation — only a timeout, an output cap, and env scrubbing.
