# Profile Isolation Pattern

> **Toda path lookup vai por um único getter** (`getTheokitHome()`). Nunca
> hardcode `~/.theokit`, nunca concatene `homedir() + "/.theokit"` no meio
> do código. Esse é o pattern que permite multiple profiles isolados
> (`THEOKIT_HOME=~/.theokit/profiles/work` vs `…/personal`) e tests
> hermeticos (`THEOKIT_HOME=$TMPDIR/test`).

## Quando aplicar

Sempre que estiver acessando state persistido:

- Config files, credentials, skills, cron jobs, kanban DB
- Cache directories
- Logs

Nunca aplique para:

- Paths que o USER passa (workspace cwd, project files)
- Paths absolutos de system tools (`/usr/bin/git`)

## Por que importa

Hermes corrigiu **5 bugs em PR #3575** que vieram de `~/.hermes` hardcoded
(per `AGENTS.md:925-928`). Cada um era um path que devia respeitar a
profile ativa mas não respeitava — quebrava isolamento em workflow
multi-tenant e em tests.

## Pattern canonical (Python)

```python
# hermes_constants.py
import os
from pathlib import Path

def get_hermes_home() -> Path:
    """The active HERMES_HOME. Set by _apply_profile_override BEFORE imports."""
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))

def display_hermes_home() -> str:
    """User-facing display string. Returns '~/.hermes' or '~/.hermes/profiles/<name>'."""
    home = get_hermes_home()
    user = Path.home()
    try:
        return "~/" + str(home.relative_to(user))
    except ValueError:
        return str(home)

def _get_profiles_root() -> Path:
    """Profiles list is ALWAYS at ~/.hermes/profiles, NOT under active HERMES_HOME.
    Lets `hermes -p coder profile list` see all profiles regardless of active one.
    """
    return Path.home() / ".hermes" / "profiles"
```

Pattern de bootstrap (`hermes_cli/main.py`):

```python
def _apply_profile_override(args):
    if args.profile:
        os.environ["HERMES_HOME"] = str(_get_profiles_root() / args.profile)
    # CRÍTICO: chamado ANTES de qualquer `from agent.* import …`
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/paths.ts
import { homedir } from "node:os";
import { join, relative } from "node:path";

export function getTheokitHome(): string {
  return process.env.THEOKIT_HOME ?? join(homedir(), ".theokit");
}

export function displayTheokitHome(): string {
  const home = getTheokitHome();
  const user = homedir();
  if (home.startsWith(user)) {
    return "~" + home.slice(user.length);
  }
  return home;
}

export function getProfilesRoot(): string {
  // Sempre ~/.theokit/profiles, NÃO sob THEOKIT_HOME ativo
  return join(homedir(), ".theokit", "profiles");
}

export function applyProfileOverride(profile: string): void {
  // Deve ser chamado antes de qualquer import que use getTheokitHome
  process.env.THEOKIT_HOME = join(getProfilesRoot(), profile);
}
```

## Os 5 rules (do AGENTS.md:877-921, traduzidos)

1. **Funções (`getTheokitHome()`) ≠ display (`displayTheokitHome()`)**.
   Code paths usam o primeiro, mensagens ao usuário usam o segundo.

2. **Setup operations são HOME-anchored**: `getProfilesRoot()` usa
   `homedir()`, não `getTheokitHome()`. Senão, `theokit -p work profile list`
   só veria profiles dentro de `work`, o que é circular.

3. **Profile overrides aplicam ANTES dos imports**: por isso o pattern é
   `applyProfileOverride()` chamado no CLI bootstrap, antes de qualquer
   `import { Agent } from "@usetheo/sdk"`.

4. **Testes monkeypatch ambos `homedir()` e `THEOKIT_HOME`**: senão
   `getProfilesRoot()` (que usa homedir) escapa do tmpdir de teste.

5. **Gateway adapters podem precisar de token locks** independentes do
   profile (Telegram só permite 1 polling/token). Lock por token, não
   por profile.

## Failure modes prevenidos

1. **State leaks entre profiles**: profile A escreve `agent_xyz` em
   `~/.hermes/agent_xyz/`, profile B esperava agent isolado mas vê
   o de A.
   Com pattern: cada profile tem own HERMES_HOME, agent_xyz só existe
   no ativo.

2. **Tests vazando para `~/.theokit/` real**: test executa, escreve
   credentials, esquece de limpar, próximo run lê creds antigas.
   Com pattern: `withTempTheokitHome(fn)` swap das envs, test fica
   isolado.

3. **Hardcoded path em refactor**: dev adiciona feature, escreve
   `homedir() + "/.theokit/new-thing"` por hábito, agora new-thing
   ignora profile setting.
   Com pattern: ESLint rule bloqueia literais `"~/.theokit"` ou
   `".theokit"` fora de `paths.ts`.

## ESLint guard sugerido

```json
// .eslintrc — bloqueia hardcoded paths fora do helper
{
  "rules": {
    "no-restricted-syntax": ["error", {
      "selector": "Literal[value=/\\.theokit/]",
      "message": "Use getTheokitHome() instead of hardcoding .theokit paths"
    }]
  }
}
```

Whitelist o próprio `paths.ts` via `eslint-disable-next-line`.

## Como testar

```typescript
// tests/internal/paths.test.ts
it("getTheokitHome respects THEOKIT_HOME env var", () => {
  process.env.THEOKIT_HOME = "/custom/path";
  expect(getTheokitHome()).toBe("/custom/path");
});

it("getTheokitHome defaults to ~/.theokit when env unset", () => {
  delete process.env.THEOKIT_HOME;
  expect(getTheokitHome()).toBe(join(homedir(), ".theokit"));
});

it("getProfilesRoot always returns ~/.theokit/profiles regardless of HOME override", () => {
  process.env.THEOKIT_HOME = "/custom/path";
  expect(getProfilesRoot()).toBe(join(homedir(), ".theokit", "profiles"));
});

it("displayTheokitHome shows ~ prefix when under home", () => {
  process.env.THEOKIT_HOME = join(homedir(), ".theokit/profiles/work");
  expect(displayTheokitHome()).toBe("~/.theokit/profiles/work");
});
```

Fixture global para hermetic isolation (próximo doc):

```typescript
// vitest.setup.ts (autouse)
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(async (ctx) => {
  const dir = await mkdtemp(join(tmpdir(), "theokit-test-"));
  ctx.theokitHome = dir;
  process.env.THEOKIT_HOME = dir;
});

afterEach(async (ctx) => {
  delete process.env.THEOKIT_HOME;
  await rm(ctx.theokitHome, { recursive: true, force: true });
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/paths.ts` — único arquivo onde `homedir() + ".theokit"` literal aparece. Todos os outros lugares importam:

```typescript
import { getTheokitHome } from "@/internal/paths";
const credsPath = join(getTheokitHome(), "credentials.json");
```

## Referências cruzadas

- [atomic-write-pattern.md](./atomic-write-pattern.md) — `path` no atomic write vem de getTheokitHome()
- [hermetic-test-isolation.md](./hermetic-test-isolation.md) — fixture que swap THEOKIT_HOME
- [file-lock-pattern.md](./file-lock-pattern.md) — lock paths também relativos

## Citações primárias

- `referencia/hermes-agent/hermes_constants.py` — Python canonical
- `referencia/hermes-agent/AGENTS.md:866-928` — 5 rules + PR #3575 anchor
- `.claude/knowledge-base/hermes-deep-dive/10-state-persistence.md:107-198` — AD-1, AD-6, AD-7
- PR #3575 (v0.6) — corrigiu 5 bugs de hardcoded paths
