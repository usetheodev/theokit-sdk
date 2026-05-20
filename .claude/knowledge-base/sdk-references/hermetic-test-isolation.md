# Hermetic Test Isolation

> Toda test run em isolated `THEOKIT_HOME` (tmp dir), credenciais
> cleared, locale fixed, time pinned. Sem isso, tests **leak** —
> escrevem em `~/.theokit/` real, corrompem config do dev, polluem
> next test run. Pattern obrigatório: autouse fixture em `vitest.setup.ts`.

## Quando aplicar

Aplique em TODO test suite que toca:

- File system (path lookup, persistence)
- Environment variables (provider creds, config flags)
- Time (date formatting, expirations, schedules)
- Locale (sorting, formatting)
- Process state (PIDs, locks)

Não aplique para:

- Pure logic tests (no I/O, no env, no time)
- Type-level tests (`tsd`-style)

## Por que importa

Hermes shipou tests que **bricked developer's `~/.hermes/`** múltiplas
vezes pre-isolamento. Erro pattern típico:

```typescript
// ❌ ANTI-PATTERN
it("creates default config", async () => {
  await ensureDefaultConfig();
  const config = await readConfig();
  expect(config.version).toBe(1);
});
// ☹ Test escreve em ~/.theokit/config.yaml REAL.
// ☹ Próximo test run vê config já existente.
// ☹ Developer perde config personal.
// ☹ CI flakes random porque concurrent tests collide.
```

Hermetic isolation previne todos esses.

## Pattern canonical (TypeScript via Vitest)

```typescript
// packages/sdk/vitest.setup.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach } from "vitest";

// Credentials que nunca devem estar set durante tests
const CREDENTIAL_ENV_PATTERNS = [
  /_API_KEY$/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /_PASSWORD$/i,
  /_CREDENTIALS$/i,
];

const savedEnv = new Map<string, string | undefined>();
let currentTestHome: string | undefined;

beforeEach(async () => {
  // 1. Isolated THEOKIT_HOME
  currentTestHome = await mkdtemp(join(tmpdir(), `theokit-test-${randomUUID()}-`));
  savedEnv.set("THEOKIT_HOME", process.env.THEOKIT_HOME);
  process.env.THEOKIT_HOME = currentTestHome;
  
  // 2. Clear credentials
  for (const key of Object.keys(process.env)) {
    if (CREDENTIAL_ENV_PATTERNS.some((p) => p.test(key))) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  }
  
  // 3. Pin time & locale
  savedEnv.set("TZ", process.env.TZ);
  savedEnv.set("LANG", process.env.LANG);
  process.env.TZ = "UTC";
  process.env.LANG = "C.UTF-8";
});

afterEach(async () => {
  // Restore env
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
  
  // Cleanup temp dir
  if (currentTestHome !== undefined) {
    await rm(currentTestHome, { recursive: true, force: true });
    currentTestHome = undefined;
  }
});
```

Wire em `vitest.config.ts`:

```typescript
// packages/sdk/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    poolOptions: {
      threads: {
        maxThreads: 4, // matches CI
        minThreads: 4,
      },
    },
  },
});
```

## Pattern Hermes (Python — referência)

```python
# tests/conftest.py:73-89 (referenced)
@pytest.fixture(autouse=True)
def _isolate_hermes_home(tmp_path, monkeypatch):
    """Redirect HERMES_HOME to a temp dir for every test."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    
    # AND patch Path.home() because some paths use homedir() directly
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    
    # Clear credentials
    for key in list(os.environ):
        if any(key.endswith(suffix) for suffix in ["_API_KEY", "_TOKEN", "_SECRET"]):
            monkeypatch.delenv(key, raising=False)
    
    yield
    # cleanup automatic via monkeypatch
```

## Por que monkey-patch Path.home() também

Mesmo `THEOKIT_HOME` está set, algumas paths usam `os.homedir()`
directly:

```typescript
// Em packages/sdk/src/internal/paths.ts (per [profile-isolation.md])
export function getProfilesRoot(): string {
  return join(homedir(), ".theokit", "profiles"); // homedir() ESCAPA THEOKIT_HOME
}
```

Esse design é intencional (per [profile-isolation.md](./profile-isolation.md)
AD-6) — operações de profile são HOME-anchored para visibility cross-profile.

MAS em test: se homedir() retorna o real home, test pode escrever em
`~/.theokit/profiles/`. Solução: monkey-patch `homedir()` para tmpdir
em tests:

```typescript
// vitest.setup.ts — extra step
import { homedir } from "node:os";

beforeEach(async () => {
  // ... isolation setup ...
  
  vi.spyOn(require("node:os"), "homedir").mockReturnValue(currentTestHome);
});
```

## Helper: `withTempTheokitHome(fn)`

Para tests que precisam de MULTIPLE isolated homes em sequência (rare):

```typescript
export async function withTempTheokitHome<T>(
  fn: (home: string) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), `theokit-${randomUUID()}-`));
  const saved = process.env.THEOKIT_HOME;
  process.env.THEOKIT_HOME = home;
  try {
    return await fn(home);
  } finally {
    process.env.THEOKIT_HOME = saved;
    await rm(home, { recursive: true, force: true });
  }
}

// Use em tests que querem multiple homes:
it("migrates state between two profiles", async () => {
  await withTempTheokitHome(async (homeA) => {
    await initProfile(homeA, "work");
    
    await withTempTheokitHome(async (homeB) => {
      await migrate(homeA, homeB);
      // Both homes exist simultaneously, cleaned up at end
    });
  });
});
```

## Disciplina: never hardcode `~/.theokit` em tests

```typescript
// ❌ ANTI-PATTERN — bypasses isolation
it("writes config", async () => {
  await writeFile(
    join(homedir(), ".theokit", "config.yaml"), // ☹ writes em real home
    "...",
  );
});

// ✅ CORRECT — uses getTheokitHome() that respects THEOKIT_HOME
it("writes config", async () => {
  await writeFile(
    join(getTheokitHome(), "config.yaml"), // → tmp dir em test
    "...",
  );
});
```

ESLint rule:

```json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "Literal[value=/\\.theokit/]",
        "message": "Use getTheokitHome() — see sdk-references/profile-isolation.md"
      }
    ]
  }
}
```

## Disciplina: clear credentials BELT-AND-SUSPENDERS

Vitest setup unsets credentials. PLUS, each test that explicitly needs
a credential MUST set it:

```typescript
// ✅ INTEGRATION TEST WITH CREDENTIALS
it.runIf(process.env.OPENROUTER_API_KEY)("real LLM call", async () => {
  // process.env.OPENROUTER_API_KEY was set by `pnpm test --env` or
  // dotenv-cli wrapper before vitest started
  const agent = await Agent.create({ apiKey: process.env.OPENROUTER_API_KEY });
  // ...
});
```

Note `runIf` — test skipped if no key. Sem skip, accidental run **with**
credentials in dev makes real LLM call (cost + provider logs).

## Failure modes prevenidos

1. **Test writes em `~/.theokit/`**: isolated home redirects → cleaned
   up. Real home untouched.

2. **Test depends on credentials set in dev shell**: tests cleared →
   test fails locally same way as CI. No "works locally" surprise.

3. **Timezone-sensitive flakes**: TZ=UTC → date formatting consistent
   across machines.

4. **Locale-sensitive sorts**: LANG=C.UTF-8 → sorting consistent.

5. **Test ordering flakes**: each test starts clean. Order doesn't
   matter (unless test explicitly sets up state).

## Failure modes NÃO prevenidos

- **Tests com side effects fora do THEOKIT_HOME**: test que escreve em
  `/tmp/something` (não em tmpdir-isolated). Defesa: prefer
  `os.tmpdir()` API que retorna unique paths.

- **Network calls em unit tests**: nada na setup previne `fetch()` para
  external. Defesa: mock fetch at agent layer.

- **Long-running cleanup hang**: `rm -rf` em afterEach pode bloquear se
  files são locked. Defesa: `force: true` + ignore errors.

## Como testar (testando a fixture)

```typescript
// vitest.setup.test.ts — meta-test do setup
it("THEOKIT_HOME points to tmpdir during test", () => {
  expect(process.env.THEOKIT_HOME).toMatch(/\/theokit-test-/);
  expect(process.env.THEOKIT_HOME).not.toBe(join(homedir(), ".theokit"));
});

it("credentials are cleared", () => {
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
});

it("TZ is UTC", () => {
  expect(process.env.TZ).toBe("UTC");
  expect(new Date().toISOString()).toMatch(/Z$/);
});

it("each test gets unique THEOKIT_HOME", () => {
  // Compare across test runs via stored env
  // This test needs to capture in beforeAll and compare
});
```

## Onde wirar no SDK

`packages/sdk/`:

- `vitest.setup.ts` — autouse fixture
- `vitest.config.ts` — `setupFiles` ref
- Helpers: `tests/utils/with-temp-home.ts` — `withTempTheokitHome`
- ESLint: ban `~/.theokit` literals

## Referências cruzadas

- [profile-isolation.md](./profile-isolation.md) — `getTheokitHome()` que test fixture overrides
- [testing-invariant-vs-snapshot.md](./testing-invariant-vs-snapshot.md) — o que testar
- [property-based-testing.md](./property-based-testing.md) — quando invariants são scaláveis

## Citações primárias

- `referencia/hermes-agent/tests/conftest.py:73-89` — `_isolate_hermes_home`
- `referencia/hermes-agent/AGENTS.md:970-985` — discipline statements
- `referencia/hermes-agent/AGENTS.md:1011-1017` — credential clear pattern
- `.claude/knowledge-base/hermes-deep-dive/14-testing-strategy.md:88-117` — ADs 3-5
