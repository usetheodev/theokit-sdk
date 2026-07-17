---
user-invocable: false
paths:
  - "**/*sandbox*"
  - "**/*Sandbox*"
description: TheoKit SDK sandbox reference — SandboxBackend / LocalSandbox execution + provisionRepo
---

# TheoKit Sandbox

```typescript
import {
  LocalSandbox,
  provisionRepo,
  SandboxBackend,
  SandboxNotAvailableError,
  SandboxSecurityError,
  RepoProvisionError,
  type ExecuteResult,
  type SandboxConfig,
  type ProvisionRepoOptions,
} from "@theokit/sdk/sandbox";
```

## `LocalSandbox` — subprocess execution

`LocalSandbox` runs commands via `/bin/sh -c` in the SAME OS as the host. It is
**NOT an isolation boundary** — no process, filesystem, or network isolation.
Its only safety affordances are a wall-clock timeout, an output-size cap, and
env scrubbing. For real isolation of untrusted code, use a container/VM backend.

```typescript
const sandbox = new LocalSandbox({
  workDir: "/tmp/work",
  timeoutMs: 5_000,
  maxOutputBytes: 1024,
  // env defaults to "inherit-scrubbed": drops *KEY* / *SECRET* / *TOKEN* /
  // *PASSWORD* / *_AUTH* from the child. Pass "all" or "core" to change.
});

const result: ExecuteResult = await sandbox.execute("echo hi", { timeoutMs: 2_000 });
console.log(result.stdout, result.exitCode, result.timedOut);

// Derived helpers on the base class (no need to reimplement):
await sandbox.writeFile("a.txt", "content");
const text = await sandbox.readFile("a.txt");
const files = await sandbox.glob("**/*.ts");
const hits = await sandbox.grep("TODO", "src");
```

## Custom backend — implement only 2 abstract methods

New backends (Docker, Firecracker, E2B) extend `SandboxBackend` and implement
only `execute` + `uploadFile`; `readFile` / `writeFile` / `glob` / `grep` /
`listDir` are derived on the base class.

```typescript
class MyBackend extends SandboxBackend {
  async execute(command: string, opts?: { timeoutMs?: number }): Promise<ExecuteResult> {
    // run command remotely; return { stdout, stderr, exitCode, timedOut }
    throw new SandboxNotAvailableError("backend offline");
  }
  async uploadFile(path: string, content: string | Buffer): Promise<void> {
    /* ... */
  }
}
```

`SandboxSecurityError` (`code: "sandbox_security"`) and
`SandboxNotAvailableError` (`code: "sandbox_not_available"`) both extend `Error`.

## `provisionRepo` — clone + checkout into the sandbox

Clones `repoUrl` into `<workDir>/<instanceId>` and checks out `ref`, running
every git command through the sandbox. The `sandbox` argument is optional — when
omitted a default `LocalSandbox` (process cwd) is used.

```typescript
const opts: ProvisionRepoOptions = {
  repoUrl: "https://github.com/acme/repo.git",
  ref: "main",           // branch, tag, or SHA (rejected if it begins with "-")
  instanceId: "task-001", // validated to [A-Za-z0-9._-] — becomes a dir name
};

const { repoDir } = await provisionRepo(new LocalSandbox({ workDir: "/tmp/work" }), opts);
// or, with the default LocalSandbox: await provisionRepo(opts);

try {
  await provisionRepo({ repoUrl: "bad", ref: "main", instanceId: "x" });
} catch (err) {
  if (err instanceof RepoProvisionError) console.error(err.instanceId, err.message);
}
```
