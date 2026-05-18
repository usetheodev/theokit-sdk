# Graceful Degradation

> Features que dependem de **system deps externos** (git, lockfile,
> better-sqlite3, @lancedb/lancedb, @opentelemetry/api) ou
> **filesystem capabilities** (WAL on NFS, symlinks on FAT) precisam de
> **lazy probe + graceful fallback**. SDK não pode crashar porque user
> não tem git instalado — silently disable feature, log informational,
> continue.

## Quando aplicar

Aplique em features que dependem de:

- System binaries (`git`, `which`, `python`, `node`)
- Optional peer deps (`@lancedb/lancedb`, `keytar`, `@opentelemetry/api`)
- Filesystem capabilities (WAL mode, symlinks, locks)
- Environment vars (provider credentials)
- Network availability

Não aplique para:

- Core deps que SDK NÃO pode rodar sem (`zod` é peer dep mas ativo)
- Errors lógicos do código (esses são bugs, not degradation)

## Por que importa

User instala `@usetheo/sdk`. Não tem git. SDK tenta `Checkpoints.create()`
→ `child_process.spawn("git", ...)` → ENOENT → crash.

Bad UX. Better: lazy probe → "checkpoints disabled (git not installed)"
→ continue normal flow.

Hermes pattern (per AD-10 em `checkpoints-v2.md` doc): probe via `which`
on init, set flag. Subsequent calls check flag, no-op if disabled.

## Pattern canonical

```typescript
// packages/sdk/src/internal/checkpoints/probe.ts
import { spawn } from "node:child_process";

let checkpointsAvailable: boolean | undefined;

export async function isCheckpointsAvailable(): Promise<boolean> {
  if (checkpointsAvailable !== undefined) return checkpointsAvailable;
  
  return new Promise<boolean>((resolve) => {
    const proc = spawn("git", ["--version"], { stdio: "ignore" });
    proc.on("close", (code) => {
      checkpointsAvailable = code === 0;
      if (!checkpointsAvailable) {
        console.info(
          "[theokit] git not found in PATH. Checkpoint feature disabled. " +
            "Install git to enable: https://git-scm.com/",
        );
      }
      resolve(checkpointsAvailable);
    });
    proc.on("error", () => {
      checkpointsAvailable = false;
      resolve(false);
    });
  });
}

// Public API:
export async function createCheckpoint(message: string): Promise<Checkpoint | null> {
  if (!await isCheckpointsAvailable()) return null; // graceful skip
  // ... actual checkpoint logic ...
}
```

## Pattern: optional peer dep

```typescript
// packages/sdk/src/internal/memory/lance-backend.ts
let lanceModule: typeof import("@lancedb/lancedb") | null | undefined;

async function getLance(): Promise<typeof import("@lancedb/lancedb") | null> {
  if (lanceModule !== undefined) return lanceModule;
  
  try {
    lanceModule = await import("@lancedb/lancedb");
    return lanceModule;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      lanceModule = null;
      return null;
    }
    throw err; // unexpected error — surface
  }
}

export async function openLanceBackend(path: string): Promise<LanceBackend> {
  const lance = await getLance();
  if (lance === null) {
    throw new ConfigurationError(
      "LanceDB backend requires '@lancedb/lancedb' peer dep. " +
        "Install with: pnpm add @lancedb/lancedb",
      { code: "lance_peer_dep_missing" },
    );
  }
  return new LanceBackend(await lance.connect(path));
}
```

Diferença vs checkpoint: aqui usuário OPT-IN para Lance (set
`backend: "lance"`). Sem dep, FAIL EXPLICITLY. Para checkpoint user
não escolheu — feature passively disable.

## Pattern: OS capability probe

```typescript
// packages/sdk/src/internal/persistence/sqlite-wal.ts (existing — pattern)
function applyWalWithFallback(db, label) {
  try {
    const result = db.pragma("journal_mode = WAL");
    if (result.toLowerCase() === "wal") return;
    logFallback(label, `got ${result}`);
  } catch (err) {
    logFallback(label, err.message);
  }
  db.pragma("journal_mode = DELETE"); // fallback
}
```

WAL failure não é fatal — fallback to DELETE journal. Log one warning.
Feature works, possibly slower.

## Pattern: feature flag por capability

```typescript
// packages/sdk/src/internal/capabilities.ts
export interface Capabilities {
  git: boolean;
  symlinks: boolean;
  wal: boolean;
  lockfile: boolean;
  lance: boolean;
  keytar: boolean;
  opentelemetry: boolean;
}

let capabilities: Capabilities | undefined;

export async function getCapabilities(): Promise<Capabilities> {
  if (capabilities !== undefined) return capabilities;
  
  capabilities = {
    git: await probeBinary("git"),
    symlinks: await probeSymlinks(),
    wal: await probeWal(),
    lockfile: await probePackage("proper-lockfile"),
    lance: await probePackage("@lancedb/lancedb"),
    keytar: await probePackage("keytar"),
    opentelemetry: await probePackage("@opentelemetry/api"),
  };
  
  return capabilities;
}

// Public surface — user pode query antes de tentar:
export const Theokit = {
  // ...
  async capabilities(): Promise<Capabilities> {
    return getCapabilities();
  },
};

// Usage:
const caps = await Theokit.capabilities();
if (!caps.git) {
  console.log("Checkpoints unavailable — install git for that feature");
}
```

## Architectural decisions

### AD-1: Probe é lazy + cached

Probes têm cost (spawn process, dynamic import). Run uma vez por process.
Subsequent calls = cache hit.

```typescript
// Wrong: probe every call
async function createCheckpoint() {
  const has = await probeBinary("git"); // ☹ spawns child_process every time
  // ...
}

// Right: probe once
let _cached: boolean | undefined;
async function isGitAvailable(): Promise<boolean> {
  return _cached ??= await probeBinary("git");
}
```

### AD-2: Log informational (not warning) for passive disable

User did nothing wrong. Don't scare them.

```typescript
// ❌ Too loud:
console.warn("⚠️  git not available — checkpoints DISABLED");

// ✅ Right tone:
console.info("[theokit] git not in PATH; checkpoints feature inactive");
```

User who cares can read; user who doesn't won't be alarmed.

### AD-3: Surface required peer deps explicitly

Opt-in features (user wrote `backend: "lance"`) → fail loud with
install instructions:

```typescript
throw new ConfigurationError(
  "Lance backend requires '@lancedb/lancedb' peer dep. " +
    "Install: pnpm add @lancedb/lancedb",
  { code: "lance_peer_dep_missing" },
);
```

Auto-detected features (telemetry probes Langfuse/Sentry/PostHog) →
silent:

```typescript
// Telemetry probe per ADR D42
const langfuse = await tryImport("@langfuse/node"); // returns null if missing
if (langfuse !== null) {
  registerExporter(langfuse);
}
// No log, no warn. User didn't ask for langfuse; we tried, it wasn't there.
```

### AD-4: Capabilities reflect runtime, not install-time

User pode have node 16 vs 22, ext4 vs NFS, Linux vs Windows. Probe at
runtime, not at install.

```typescript
// At install time you don't know NFS vs ext4
// At runtime: try, fallback
```

### AD-5: Document capability matrix

User precisa saber "what works without X?". Documentação:

| Feature | Requires |
|---|---|
| `Agent.send` | nothing (core) |
| `Memory.search` | better-sqlite3 (built-in) |
| `Memory.search` w/ LanceDB | @lancedb/lancedb (peer dep) |
| `Checkpoints.create` | git binary |
| OAuth MCP | keytar (peer dep) for keychain; fallback file 0600 |
| Telemetry | @opentelemetry/api (peer dep) — no-op without |

User scanning README knows what to install.

## Failure modes prevenidos

1. **Crash on missing system binary**: lazy probe + skip.
2. **Crash on missing peer dep**: dynamic import + null check.
3. **Crash on NFS filesystem**: WAL fallback to DELETE.
4. **Crash on Windows without flock**: proper-lockfile abstracts; falls
   back to lockfile method.
5. **User confused why feature off**: log info on init.

## Failure modes NÃO prevenidos

- **Feature degraded silently**: user thinks checkpoints work, they
  don't — no error, no warn. Mitigation: capabilities API let user
  query before relying.

- **Probe is slow**: spawn git --version takes 50ms first time. Acceptable
  but adds to cold start. Mitigation: probe in parallel during Agent.create
  init.

- **Permission errors on probe**: probe spawns process, lacks perms,
  returns false. Could be temporary (locked dir, etc.). Mitigation:
  retry once at next call instead of forever cached false.

## Como testar

```typescript
it("createCheckpoint returns null when git missing", async () => {
  vi.spyOn(child_process, "spawn").mockImplementation((cmd) => {
    if (cmd === "git") return mockProcess({ exitCode: 127 });
    return mockProcess();
  });
  
  const result = await createCheckpoint("test");
  expect(result).toBeNull();
});

it("LanceBackend throws clear error when peer dep missing", async () => {
  vi.spyOn(global, "import").mockRejectedValue({ code: "ERR_MODULE_NOT_FOUND" });
  
  await expect(openLanceBackend("/path")).rejects.toThrow(/peer dep/);
});

it("capabilities() reflects environment", async () => {
  vi.spyOn(child_process, "spawn").mockImplementation(() => mockProcess({ exitCode: 0 }));
  
  const caps = await getCapabilities();
  expect(caps).toMatchObject({
    git: expect.any(Boolean),
    wal: expect.any(Boolean),
    // ...
  });
});

it("probe is cached after first call", async () => {
  const spawnSpy = vi.spyOn(child_process, "spawn");
  await isGitAvailable();
  await isGitAvailable();
  await isGitAvailable();
  
  expect(spawnSpy).toHaveBeenCalledTimes(1); // cached
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/capabilities.ts`:

- `probeBinary(name)` — spawn `name --version`, check exit code
- `probePackage(name)` — dynamic import, catch missing
- `probeWal()` — open :memory: DB, try PRAGMA, check result
- `getCapabilities()` — orchestrator
- Public: `Theokit.capabilities()` em surface API

Audit sites com optional deps:

```bash
grep -rn "@lancedb\|keytar\|@opentelemetry\|@langfuse\|@sentry\|posthog-node" packages/sdk/src/
```

Each match → audit: dynamic import + null fallback?

## Referências cruzadas

- [error-context-surfacing.md](./error-context-surfacing.md) — fail loud vs silent decisions
- [sqlite-wal-fallback.md](./sqlite-wal-fallback.md) — canonical degradation pattern
- [plugin-contract-design.md](./plugin-contract-design.md) — provider plugins use this

## Citações primárias

- ADR D66 (proposto) — Checkpoints v2 shells out to git, lazy probe
- ADR D42 (existente) — Auto-instrumentation via createRequire feature-detect
- `.claude/knowledge-base/hermes-deep-dive/06-execution-backends.md` — backend probe patterns
- v0.13 #21193 — security probe patterns
