# 06 — Seven Execution Backends

> Hermes ships seven terminal backends behind a single `BaseEnvironment` ABC
> in `tools/environments/base.py` (843 LoC). Each backend implements
> `_run_bash(cmd_string, *, login, timeout, stdin_data)` and `cleanup()`;
> the base provides session-snapshot sourcing, CWD tracking, interrupt
> handling, timeout enforcement, and bulk file sync via the
> `file_sync.py` (399 LoC) helper. The seven: `local`, `docker`, `ssh`,
> `singularity`, `modal`, `daytona`, `vercel-sandbox`. Unified
> spawn-per-call execution model landed in v0.9 PR #6343; bulk SSH/Modal
> file sync via tar in PR #8014 by @alt-glitch. In TypeScript:
> `Agent.create({ backend: "local" | "docker" | "ssh" | "singularity" |
> "modal" | "daytona" | "vercel-sandbox" })`, with each backend a separate
> peer-dep adapter implementing the `ExecutionBackend` interface.

## What problem this domain solves

The agent has to run shell commands. "Where" those commands run is a
spectrum:

1. **Local** — same process tree as Hermes itself. Fast, dangerous (no isolation), always available.
2. **Docker** — local containerized. Strong isolation, fast for repeat use after image pull.
3. **SSH** — remote machine over SSH. Isolation + cross-platform reach (use a Linux box from your Mac).
4. **Singularity** — HPC-style container runtime, common on academic clusters. Image-based, no daemon.
5. **Modal** — serverless compute (Modal Labs). Cold-starts when idle (~0 cost between sessions), GPU-friendly.
6. **Daytona** — managed cloud sandboxes. Persistent state, hibernates when idle.
7. **Vercel Sandbox** — Vercel's compute sandbox. Edge-native, fast cold-start, integrated with Vercel deployments.

Each has wildly different latency, cost, isolation, and capability profiles. Hermes' design move: **one ABC, seven implementations**, and let the agent's tools (terminal, write_file, execute_code) work uniformly across all of them. The `execute()` method on the base class handles snapshot sourcing, CWD persistence, and interrupts identically; each subclass only knows how to spawn its own `bash`.

The hard subproblem is **state continuity across calls**. A `cd /foo` in one call should affect the *next* call's working directory. Naïve subprocess invocation loses this — every spawn has its own pwd. The base class fixes it with two tricks: (1) a session snapshot of env/aliases/functions captured at init time and re-sourced before each command; (2) CWD-marker stdout sentinels that the parent process parses to track the current pwd between calls (`base.py:417-467`).

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `tools/environments/base.py` | 843 | `BaseEnvironment` ABC. Session snapshot, CWD tracking, `_wait_for_process`, timeout enforcement, interrupt loop. |
| `tools/environments/local.py` | 592 | Local subprocess execution. Termux-aware (uses `TMPDIR` instead of `/tmp` on Android). |
| `tools/environments/docker.py` | 656 | Docker `exec` against a persistent container. Volume mounts opt-in. |
| `tools/environments/ssh.py` | 295 | SSH client invocations. Preflight check, key auth. |
| `tools/environments/singularity.py` | 262 | Singularity/Apptainer `exec`. SIF image cache. |
| `tools/environments/modal.py` | 473 | Modal SDK `Sandbox.create.aio` + `exec.aio`. |
| `tools/environments/managed_modal.py` | 282 | Hermes-hosted Modal variant. |
| `tools/environments/modal_utils.py` | 199 | Modal SDK helpers. |
| `tools/environments/daytona.py` | 270 | Daytona SDK wrapper. |
| `tools/environments/vercel_sandbox.py` | 654 | Vercel Sandbox API integration. |
| `tools/environments/file_sync.py` | 399 | Unified file sync — host ↔ remote, mtime-cached, tar-pipe for bulk. |

Total: **4925 LoC** across 11 files (per `wc -l` above).

## Canonical entry point

```python
# tools/environments/base.py:288
class BaseEnvironment(ABC):
    """Common interface and unified execution flow for all Hermes backends.

    Subclasses implement ``_run_bash()`` and ``cleanup()``.  The base class
    provides ``execute()`` with session snapshot sourcing, CWD tracking,
    interrupt handling, and timeout enforcement.
    """

    _stdin_mode: str = "pipe"  # "pipe" or "heredoc"
    _snapshot_timeout: int = 30

    def __init__(self, cwd: str, timeout: int, env: dict = None):
        self.cwd = cwd
        self.timeout = timeout
        self.env = env or {}
        self._session_id = uuid.uuid4().hex[:12]
        self._snapshot_path = f"{temp_dir}/hermes-snap-{self._session_id}.sh"
        self._cwd_file = f"{temp_dir}/hermes-cwd-{self._session_id}.txt"
        self._cwd_marker = _cwd_marker(self._session_id)
        self._snapshot_ready = False

    @abstractmethod
    def cleanup(self): ...

    def _run_bash(self, cmd_string, *, login=False, timeout=120, stdin_data=None) -> ProcessHandle:
        """Must be overridden by every backend."""
        raise NotImplementedError(...)
```

## Happy path: `cd && ls` on a fresh Docker backend

```
USER message: "what's in this repo?"
  └─ Agent invokes terminal tool: terminal(command="cd /workspace && ls -la")

[Tool dispatcher]
  └─ env = DockerEnvironment(cwd="/workspace", timeout=120, env={})
       └─ __init__ sets _session_id, _snapshot_path, _cwd_file, _cwd_marker

  └─ env.init_session()  # first-call only
       └─ base.py:351
       └─ Builds bootstrap script:
            export -p > /tmp/hermes-snap-<id>.sh
            declare -f >> /tmp/hermes-snap-<id>.sh
            alias -p >> /tmp/hermes-snap-<id>.sh
            builtin cd /workspace
            pwd -P > /tmp/hermes-cwd-<id>.txt
            printf '\n<MARKER>%s<MARKER>\n' "$(pwd -P)"
       └─ env._run_bash(bootstrap, login=True, timeout=30)
       └─ Process exits → _snapshot_ready = True
       └─ Parses MARKER from stdout → self.cwd = "/workspace"

  └─ env.execute(command="ls -la", cwd="/workspace")
       └─ wrapped = env._wrap_command("ls -la", "/workspace")
            └─ base.py:417-467
            └─ Builds:
                 source /tmp/hermes-snap-<id>.sh >/dev/null 2>&1 || true
                 builtin cd -- '/workspace' || exit 126
                 eval 'ls -la'
                 __hermes_ec=$?
                 export -p > /tmp/hermes-snap-<id>.sh 2>/dev/null || true
                 pwd -P > /tmp/hermes-cwd-<id>.txt 2>/dev/null || true
                 printf '\n<MARKER>%s<MARKER>\n' "$(pwd -P)"
                 exit $__hermes_ec
       └─ env._run_bash(wrapped, timeout=120)
            └─ DockerEnvironment subclass:
                 docker exec -i <container_id> bash <<EOF
                 <wrapped script>
                 EOF
       └─ env._wait_for_process(proc, timeout=120)
            └─ base.py:483
            └─ Polls poll() with periodic is_interrupted() checks
            └─ Fires activity_callback every 10s for gateway liveness
            └─ Reads stdout, accumulates result["stdout"]
            └─ If timeout exceeded → proc.kill() + raises Timeout
            └─ If is_interrupted() → proc.kill() + records partial output
            └─ Returns {stdout, returncode}

  └─ env._update_cwd(result)
       └─ Parses MARKER from stdout → self.cwd = "/workspace" (unchanged in this case)

  └─ env._strip_markers_from_stdout(result)
       └─ Returns clean stdout for the agent

[Tool dispatcher returns the result as a structured JSON to the agent.]

[Second call: terminal(command="cd src && pwd")]
  └─ env.execute("cd src && pwd", cwd="/workspace")
       └─ _wrap_command sources snapshot (which has prior env updates)
       └─ cd /workspace (the persisted cwd) then runs the command
       └─ pwd marker stdout returns "/workspace/src"
       └─ env.cwd updated to "/workspace/src"

[Third call: terminal(command="ls")]
  └─ env.execute("ls", cwd="/workspace/src")  # cwd from prior call
       └─ Lists files inside src/

[Agent done. Cleanup:]
  └─ env.cleanup()
       └─ DockerEnvironment: docker stop <container_id> + docker rm <container_id>
       └─ Local/SSH/Singularity: rm temp files
       └─ Modal: sandbox.terminate()
       └─ Daytona: workspace.stop()
       └─ Vercel Sandbox: sandbox.kill()
```

## Architectural decisions

### AD-1: Unified spawn-per-call model — no persistent shell process

- **Decision**: Every command spawns a fresh `bash -c` (or equivalent). No persistent interactive shell across calls. Continuity comes from sourcing the snapshot at the start of each spawn.
- **Evidence**: `base.py:1-7` (module docstring): "Unified spawn-per-call model: every command spawns a fresh `bash -c` process. A session snapshot (env vars, functions, aliases) is captured once at init and re-sourced before each command. CWD persists via in-band stdout markers (remote) or a temp file (local)."
- **Rationale**: Persistent shells were the v0.3 design (`persistent shell mode` per PR #1067 / #1483 by @alt-glitch). They broke on every backend variation — Docker exec / Modal sandbox / SSH all have slightly different pty semantics. Spawn-per-call works the same across all of them; the snapshot trick gives the *appearance* of continuity. PR #6343 (v0.9) unified the model.
- **TypeScript translation**: Same pattern. Each command spawns a new `bash` (POSIX) or `cmd.exe` (Windows). State carried via snapshot file + CWD marker.

### AD-2: Session snapshot file replays env + aliases + functions

- **Decision**: On `init_session`, capture `export -p` (env vars), `declare -f` (functions), `alias -p` (aliases) into a snapshot file. Re-source it at the start of every command. After every command, re-dump env vars.
- **Evidence**: `base.py:351-401` (`init_session`) and `:437-454` (`_wrap_command` snapshot sourcing and re-dump).
- **Rationale**: Without this, an `export FOO=bar` in one call has no effect on the next. The snapshot makes `export`, `function foo() { ... }`, `alias ll='ls -la'` persist across calls.
- **TypeScript translation**: Identical. We write a `theokit-snap-<id>.sh` file under the backend's temp dir and source it on each command.

### AD-3: CWD persistence via stdout marker (remote) or temp file (local)

- **Decision**: After every command, the wrapped script emits a unique marker around the current `pwd -P` to stdout. The parent process parses the marker out of stdout to know where the next command should `cd`.
- **Evidence**: `base.py:417-467` (`_wrap_command`):

  ```bash
  printf '\n%s%s%s\n' "$_cwd_marker" "$(pwd -P)" "$_cwd_marker"
  ```

  And the marker creation at `base.py:320`: `_cwd_marker(self._session_id)`.

- **Rationale**: Remote backends (SSH, Docker, Modal) have no shared filesystem with the parent. Stdout is the only reliable channel. Local backend additionally writes to a temp file as a backup.
- **TypeScript translation**: Same marker pattern. Hermes uses a UUID-based marker (`hermes-cwd-<sessid>`); we'd use `theokit-cwd-<sessid>`.

### AD-4: Interrupt handling at the poll loop

- **Decision**: `_wait_for_process` polls every ~50ms, checks `is_interrupted()` between polls. On interrupt: `proc.kill()`, drain remaining stdout, return partial result.
- **Evidence**: `base.py:483-` (`_wait_for_process`, started at :483, not fully shown). Plus the activity callback at `base.py:46-78` that fires every 10s for gateway liveness.
- **Rationale**: The agent can be interrupted mid-tool-call (user types `/stop` or sends a new message). The tool must yield cleanly, not block forever.
- **TypeScript translation**: `AbortSignal` propagated to the child process. `child.kill('SIGTERM')` on abort. Same polling cadence.

### AD-5: Timeout caps every command

- **Decision**: Every `execute()` takes a `timeout` (default 120s). Exceeding it raises and kills the process. Activity callback fires periodically so the gateway can show "(N seconds elapsed)" instead of looking frozen.
- **Evidence**: `base.py:311-314` constructor signature, plus `touch_activity_if_due` at `:55-78`.
- **Rationale**: A runaway `infinite-loop-test.sh` should not deadlock the agent. 120s is permissive enough for most builds; the agent can pass a higher value explicitly.
- **TypeScript translation**: Same constructor signature. Implementation uses `setTimeout` + `child.kill`.

### AD-6: Stdin via pipe (POSIX) or heredoc (SDK backends)

- **Decision**: Local/Docker/SSH/Singularity write stdin via pipe. Modal/Daytona/Vercel use heredoc embedding because their SDK invocations don't expose a stdin stream.
- **Evidence**: `base.py:296` class attribute `_stdin_mode = "pipe"`. Subclasses set `"heredoc"`. `_embed_stdin_heredoc` at `base.py:473-477`.
- **Rationale**: Modal's `exec.aio` and Daytona's exec take string commands without a stdin stream. We embed the stdin as a bash heredoc: `cmd << 'DELIMITER'\n<stdin_data>\nDELIMITER`. Local/Docker/SSH have a proper stdin pipe.
- **TypeScript translation**: Same dichotomy. Local/Docker/SSH use Node's `child.stdin.write` + `child.stdin.end()`. Modal/Daytona/Vercel embed heredoc.

### AD-7: File sync via tar pipe for bulk operations

- **Decision**: For remote backends (SSH, Modal), bulk file sync uses `tar` pipes — both host-to-remote and remote-to-host. `file_sync.py` (399 LoC) is the unified helper.
- **Evidence**: `tools/environments/file_sync.py` — file exists, 399 LoC. PR #8014 (v0.9) by @alt-glitch: "Bulk file sync via tar pipe for SSH/Modal backends".
- **Rationale**: Per-file scp/rsync over SSH is O(N × handshake). Tar piping is O(1) handshake + O(N) bytes — orders of magnitude faster for large directory trees.
- **TypeScript translation**: Use `tar` or `node-tar` package piped through the SSH/Modal child process.

### AD-8: mtime+size cache for credential file mounting

- **Decision**: When mounting credential files into Modal/Docker, check the host file's `(mtime, size)` against the last-known. Skip transfer if unchanged.
- **Evidence**: `base.py:173-179` (`_file_mtime_key`):

  ```python
  def _file_mtime_key(host_path: str) -> tuple[float, int] | None:
      """Return ``(mtime, size)`` for cache comparison, or ``None`` if unreadable."""
      try:
          st = Path(host_path).stat()
          return (st.st_mtime, st.st_size)
      except OSError:
          return None
  ```

  And PR #3671 (v0.6) "Mount credential files into remote backends with mtime+size caching".

- **Rationale**: Credentials don't change often. Re-uploading on every backend init wastes a second of latency.
- **TypeScript translation**: Same key format. Use `fs.statSync(path).mtimeMs + ":" + fs.statSync(path).size`.

### AD-9: Backend-specific cleanup is required

- **Decision**: Every backend must implement `cleanup()`. The default does nothing. Backends with off-process state (containers, sandboxes, SSH connections) must explicitly tear down.
- **Evidence**: `base.py:342-345`:

  ```python
  @abstractmethod
  def cleanup(self):
      """Release backend resources (container, instance, connection)."""
      ...
  ```

- **Rationale**: A leaked Docker container or Modal sandbox costs money. Forced explicit cleanup means no backend can silently leak.
- **TypeScript translation**: `Symbol.asyncDispose` plus a manual `dispose()`. Implementation as `using env = await DockerEnvironment.create({…})`.

### AD-10: HERMES_DEBUG_INTERRUPT env var for forensic logging

- **Decision**: Setting `HERMES_DEBUG_INTERRUPT=1` enables detailed trace logging of the interrupt/activity/poll machinery.
- **Evidence**: `base.py:28-40`:

  ```python
  _DEBUG_INTERRUPT = bool(os.getenv("HERMES_DEBUG_INTERRUPT"))
  if _DEBUG_INTERRUPT:
      logger.setLevel(logging.INFO)
  ```

- **Rationale**: Concurrency bugs in the poll/interrupt loop are extremely hard to debug after the fact. The env var enables forensics without bloating normal logs.
- **TypeScript translation**: `THEOKIT_DEBUG_INTERRUPT=1` env var. Same scoped log activation.

### AD-11: Termux-specific tmp dir override

- **Decision**: On Termux (Android), `/tmp` doesn't always exist. Local backend overrides `get_temp_dir()` to use `TMPDIR` env var.
- **Evidence**: `base.py:302-309` and the LocalEnvironment override (`local.py`).
- **Rationale**: Hermes officially supports Termux for mobile use (per README:53-55). Hardcoding `/tmp` broke that.
- **TypeScript translation**: Use Node's `os.tmpdir()` which already handles this cross-platform.

### AD-12: Windows-safe stdin via byte buffer

- **Decision**: `_pipe_stdin` writes through `proc.stdin.buffer` (raw bytes), not the text-mode wrapper, to avoid `\n` → `\r\n` translation on Windows.
- **Evidence**: `base.py:101-132`:

  ```python
  # On Windows, text-mode stdin (text=True / encoding="utf-8")
  # translates \n → \r\n as the data flows through the pipe —
  # which corrupts every write_file / patch call because the bytes that
  # land on disk include injected carriage returns.
  ```

- **Rationale**: A write_file call with content `"a\nb\nc"` should produce 5 bytes on disk. Text-mode stdin on Windows expands to 7 bytes (`"a\r\nb\r\nc"`). Every subsequent byte-count compare fails.
- **TypeScript translation**: Node's `child.stdin.write(Buffer.from(data, 'utf-8'))` — explicit Buffer, no encoding translation.

## Per-backend specifics (one paragraph each)

- **Local** (`local.py`, 592 LoC) — `subprocess.Popen` with `preexec_fn` for SIGINT propagation. Snapshot file under `/tmp` (or `TMPDIR` on Termux). Direct CWD update via temp file read (no marker parsing needed).
- **Docker** (`docker.py`, 656 LoC) — Persistent container created on first `init_session`. `docker exec -i` per command. Volume mount opt-in via `docker.workspace_mount` config (PR #1534 made it explicit, no auto-mount). Image: `hermes/sandbox:latest` by default.
- **SSH** (`ssh.py`, 295 LoC) — `ssh user@host bash -c '<wrapped>'`. Preflight `ssh -o ConnectTimeout=…` check (PR #1486). Key auth required (no password prompts). Persistent shell mode: PR #1067 by @alt-glitch.
- **Singularity** (`singularity.py`, 262 LoC) — `singularity exec <image.sif> bash -c '<wrapped>'`. SIF cache under `<sandboxes>/singularity/`. No daemon; image is the runtime.
- **Modal** (`modal.py`, 473 LoC + `managed_modal.py` 282 LoC + `modal_utils.py` 199 LoC) — Modal SDK `Sandbox.create.aio(image=…, cpu=…, memory=…)` + `exec.aio('bash', '-c', wrapped)`. Native Modal SDK replaced swe-rex in v0.5 PR #3538. Image build cached.
- **Daytona** (`daytona.py`, 270 LoC) — Daytona SDK workspace creation. Workspaces hibernate when idle (nearly-zero cost between sessions). Migration `find_one` → `get/list` in v0.4 PR #2063 by @rovle.
- **Vercel Sandbox** (`vercel_sandbox.py`, 654 LoC) — Newest (v0.12 PR #17445 by @kshitijk4poor). Vercel's compute API. Fast cold-start, integrated billing with existing Vercel accounts.

## Data structures

### Persisted

Each backend writes to `<HERMES_HOME>/sandboxes/<backend>/`:

- **Docker**: `containers.json` — `{container_id, image, created_at, last_used_at}`.
- **Modal/Daytona/Vercel**: SDK-managed state on the provider's side; local cache of resource IDs.
- **Singularity**: SIF image cache as files.
- **SSH**: no persistent local state; relies on SSH agent/key.
- **Local**: temp snapshot + cwd files under `/tmp/hermes-snap-<id>.sh` / `/tmp/hermes-cwd-<id>.txt`.

Configurable root via `TERMINAL_SANDBOX_DIR` env var (`base.py:81-93`).

### In-memory

`BaseEnvironment` instance per agent + per backend choice. Held by the agent's tool dispatcher for the duration of the session.

### Concurrency model

- **One environment per agent**. Tool calls within a single agent are sequential.
- **Multiple agents** may have independent environments (one each). Concurrent backends are fine as long as they're isolated (different container IDs, different SSH connections).
- **Thread-local activity callback** (`_activity_callback_local`, `base.py:43`) — for gateway liveness signaling.

## Failure modes Hermes already fixed

1. **macOS bash 3.2 leaks env vars to stdout** — `source snap.sh` emits `declare -x` to stdout. Fixed by `>/dev/null 2>&1` redirect (`base.py:432-440`, issue #15459).
2. **Windows `\n` → `\r\n` translation corrupts writes** — fixed by byte-buffer stdin (`base.py:101-132`).
3. **Git Bash colons break paths** — `C:/Users/.../snap-*.sh` parsed as globs. Fixed by `shlex.quote` on every snapshot/cwd-file reference (`base.py:362-371`).
4. **Login shell `bashrc` changes CWD away from terminal.cwd** — fixed by restoring cwd in bootstrap *after* sourcing (`base.py:362-380`).
5. **Spawn-then-immediately-reclaim loop on slow LLM calls** — addressed in kanban domain.
6. **Daytona API `find_one` deprecated** — fixed in v0.4 PR #2063 migrating to `get/list`.
7. **Modal swe-rex tunnel overhead** — eliminated by native SDK in v0.5 PR #3538.
8. **Docker `cwd` mount as opt-in not default** — v0.3 PR #1534 hardened against auto-mounting host filesystem.
9. **Concurrent tool batching path-unaware for file mutations** — v0.4 PR #1914 made batching path-aware so sequential ordering is preserved for the same file.
10. **Modal/Daytona credential leaks via env** — v0.3 PRs #1157/#1172/#1399/#1419 strip Hermes provider env vars from subprocess environments.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export type ExecutionBackend =
  | "local"
  | "docker"
  | "ssh"
  | "singularity"
  | "modal"
  | "daytona"
  | "vercel-sandbox";

declare module "./agent" {
  interface AgentOptions {
    backend?: ExecutionBackend | ExecutionEnvironment;
    backendOptions?: BackendOptions;
  }
}

export type BackendOptions =
  | LocalOptions
  | DockerOptions
  | SshOptions
  | SingularityOptions
  | ModalOptions
  | DaytonaOptions
  | VercelSandboxOptions;

export interface DockerOptions {
  image?: string;
  workspaceMount?: { hostPath: string; mountPath: string };  // explicit opt-in
  env?: Record<string, string>;
}

// Internal ABC
export abstract class ExecutionEnvironment {
  abstract cleanup(): Promise<void>;
  protected abstract _runBash(
    cmdString: string,
    opts: { login?: boolean; timeoutMs?: number; stdinData?: string }
  ): Promise<ProcessHandle>;

  async execute(command: string, opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>;
  async initSession(): Promise<void>;
  async [Symbol.asyncDispose](): Promise<void>;
}
```

### Internal module layout

```
packages/sdk/src/internal/environments/
├── base.ts                       # ExecutionEnvironment ABC + execute(), init_session()
├── snapshot.ts                   # Snapshot file creation + sourcing
├── cwd-marker.ts                 # CWD marker parsing
├── interrupt.ts                  # is_interrupted, activity callback
├── wait-for-process.ts           # Polling, timeout, partial output
├── file-sync.ts                  # Tar-pipe bulk sync
├── local.ts
├── docker.ts
├── ssh.ts
├── singularity.ts
├── modal.ts
├── daytona.ts
└── vercel-sandbox.ts
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `dockerode` | Docker daemon API | Only if `backend: "docker"` |
| `ssh2` | SSH client | Only if `backend: "ssh"` |
| `modal` | Modal SDK | Only if `backend: "modal"` |
| `@daytonaio/sdk` | Daytona SDK | Only if `backend: "daytona"` |
| `@vercel/sandbox` | Vercel Sandbox SDK | Only if `backend: "vercel-sandbox"` |
| `tar` | Bulk file sync | Always for remote backends |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes if v1.2 used in-process execution. The default `backend: "local"` matches existing behavior.
- **Breaking signature changes**: None.

## Test strategy

Port Hermes' `tests/environments/` (per `find tests/environments`) including:
- Snapshot sourcing
- CWD persistence across calls
- Interrupt mid-execution
- Timeout enforcement
- Each backend's spawn/cleanup
- File sync tar-pipe correctness
- Credential mount with mtime cache

Real-LLM tests: agent uses each backend to run a `git clone && ls` and assert results.

## Open questions

- **Backend bundling**: ship all 7 in the core SDK or split into peer-dep packages? Recommend split: `@usetheo/sdk-backend-docker`, `@usetheo/sdk-backend-modal`, etc. Keeps core small.
- **Vercel Sandbox API stability**: very new (v0.12, May 2026). May change. Build the adapter with a stable internal interface so we can pivot if Vercel's API changes.
- **Singularity for HPC users**: niche but valuable. Worth including in core docs?
- **Local-Windows native vs WSL2**: Hermes treats WSL2 as the canonical Windows path; native is "early beta". For TheoKit, do we support native Windows out of the box?

## References

- `referencia/hermes-agent/tools/environments/base.py:1-843`
- `referencia/hermes-agent/tools/environments/local.py`, `docker.py`, `ssh.py`, `singularity.py`, `modal.py`, `managed_modal.py`, `daytona.py`, `vercel_sandbox.py`
- `referencia/hermes-agent/tools/environments/file_sync.py:1-399`
- RELEASE_v0.5.0.md PR #3538 — native Modal SDK
- RELEASE_v0.9.0.md PR #6343 — unified spawn-per-call execution
- RELEASE_v0.9.0.md PR #8014 — bulk tar-pipe sync
- RELEASE_v0.12.0.md PR #17445 — Vercel Sandbox backend
- AGENTS.md:36 — "Terminal backends (local, docker, ssh, modal, daytona, singularity)"
- Theokit ADRs: none specifically — this is greenfield for v1.3.
