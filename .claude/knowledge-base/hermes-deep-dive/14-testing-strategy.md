# 14 — Testing Strategy (Cross-Cutting)

> Hermes runs **~17k tests across ~900 files** (per AGENTS.md:62) via a
> single sanctioned entrypoint: `scripts/run_tests.sh`. That wrapper
> guarantees CI parity — 4 xdist workers, TZ=UTC, LANG=C.UTF-8,
> credential env vars unset, hermetic HERMES_HOME per test via an
> autouse fixture in `tests/conftest.py` (965 LoC). Change-detector
> tests are explicitly banned — write invariants, not snapshots
> (AGENTS.md:1033-1077). Stress tests under `tests/stress/` (10 files,
> 2955 LoC) cover concurrency edges — claim races, reclaim races,
> property-based fuzzing. Real-LLM validation is allowed but gated
> behind explicit credentials, kept out of `run_tests.sh`'s hermetic
> path. In TypeScript: Vitest with the same disciplines — single
> `pnpm test` entrypoint, autouse `vitest.setup.ts` that isolates
> `THEOKIT_HOME`, identical no-change-detector rule.

## What problem this domain solves

Two intertwined problems:

1. **Local matches CI**. Without enforcement, a test passes locally and fails in CI (or vice versa). The wrapper script eliminates five common drift sources: credential env vars, HOME path, timezone, locale, xdist worker count.

2. **Tests don't bleed between runs**. A test that writes to `~/.hermes/config.yaml` would corrupt the developer's actual config — and contaminate every subsequent test. The autouse fixture redirects `HERMES_HOME` to a temp dir per test.

The deeper concern: **what makes a test valuable?** Hermes' answer (per AGENTS.md:1033-1077): tests that assert *invariants* survive every minor code change. Tests that assert *snapshots* (specific model names in a catalog, specific config version numbers) break on every routine update and cost engineering time without adding coverage. The team explicitly bans change-detector tests in code review.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `scripts/run_tests.sh` | 129 | Canonical test entrypoint. Sets env, activates venv, runs pytest with `-n 4`. |
| `tests/conftest.py` | 965 | Autouse fixtures: `_isolate_hermes_home`, credential clearing, time/locale pinning. |
| `tests/stress/conftest.py` | 37 | Stress-test-specific fixtures. |
| `tests/stress/*.py` (10 files) | 2955 | Concurrency stress tests, property fuzzing, benchmarks. |
| `tests/*/test_*.py` (~900 files) | ~17k total | The full suite. |

Confirmed via `wc -l`: `scripts/run_tests.sh` 129 LoC, `tests/conftest.py` 965 LoC, `tests/stress/` totaling 2955 LoC.

## Canonical entry point

```bash
# scripts/run_tests.sh
scripts/run_tests.sh                                  # full suite, CI-parity
scripts/run_tests.sh tests/gateway/                   # one directory
scripts/run_tests.sh tests/agent/test_foo.py::test_x  # one test
scripts/run_tests.sh -v --tb=long                     # pass-through pytest flags
```

What the wrapper does (`scripts/run_tests.sh:1-19`):
- 4 xdist workers (matches CI's 4-core runner)
- TZ=UTC, LANG=C.UTF-8, PYTHONHASHSEED=0
- Credential env vars unset
- Venv activation (`.venv` preferred, fall back to `venv`)
- Installs `pytest-split` if missing (for shard-equivalent runs)

## Architectural decisions

### AD-1: `scripts/run_tests.sh` is the only sanctioned entrypoint

- **Decision**: Direct `pytest` is forbidden. Every test invocation must go through the wrapper.

- **Evidence**: `scripts/run_tests.sh:1-19` plus AGENTS.md:990-993:

  > **ALWAYS use `scripts/run_tests.sh`** — do not call `pytest` directly. The script enforces
  > hermetic environment parity with CI (unset credential vars, TZ=UTC, LANG=C.UTF-8,
  > 4 xdist workers matching GHA ubuntu-latest). Direct `pytest` on a 16+ core
  > developer machine with API keys set diverges from CI in ways that have caused
  > multiple "works locally, fails in CI" incidents (and the reverse).

- **Rationale**: Local-vs-CI drift wastes engineering time. The wrapper makes it impossible (without explicit override) to run with a divergent config.

- **TypeScript translation**: `pnpm test` script in `package.json` that calls `cross-env` + `vitest`. Same env-var enforcement.

### AD-2: 4 xdist workers — matches CI

- **Decision**: Always `-n 4`. Higher worker counts surface test-ordering flakes that CI never sees.

- **Evidence**: AGENTS.md:1025-1027:

  > Worker count above 4 will surface test-ordering flakes that CI never sees.

- **Rationale**: Developer machines have 16+ cores. `-n auto` uses all of them, exposing edge cases that CI's 4-core environment never hits. Hammering down to 4 matches CI exactly.

- **TypeScript translation**: Vitest's `--threads --max-threads=4 --min-threads=4`. Same hard cap.

### AD-3: Credential env vars unset before tests run

- **Decision**: Every `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_CREDENTIALS` env var is cleared before tests run. Belt-and-suspenders: both the wrapper script and `conftest.py:_isolate_hermes_home` enforce it.

- **Evidence**: `tests/conftest.py:73-89` lists the explicit set. AGENTS.md:1011-1017 confirms.

- **Rationale**: A test that *accidentally* makes a real LLM call (because the developer's `OPENAI_API_KEY` was set) wastes money and pollutes provider logs. Unsetting at test start means real calls *only* happen when a test explicitly provides credentials.

- **TypeScript translation**: Vitest setup file unsets the same prefix list. We also recommend `dotenv-cli` for tests that need fixtures.

### AD-4: Hermetic `HERMES_HOME` via autouse fixture

- **Decision**: `tests/conftest.py:_isolate_hermes_home` is an autouse fixture that redirects `HERMES_HOME` to a temp dir before every test.

- **Evidence**: AGENTS.md:970-972:

  > **Tests must not write to `~/.hermes/`**
  > The `_isolate_hermes_home` autouse fixture in `tests/conftest.py` redirects `HERMES_HOME` to a temp dir. Never hardcode `~/.hermes/` paths in tests.

- **Rationale**: A test that writes to `~/.hermes/config.yaml` corrupts the developer's real config. Even with the redirect, hardcoded `~/.hermes` paths bypass it. Banning them keeps the autouse fixture load-bearing.

- **TypeScript translation**: `vitest.setup.ts` has a `beforeEach` that sets `process.env.THEOKIT_HOME = path.join(os.tmpdir(), `theokit-test-${randomUUID()}`)` and cleans up in `afterEach`.

### AD-5: TZ=UTC, LANG=C.UTF-8, PYTHONHASHSEED=0

- **Decision**: Tests run with fixed time zone, locale, and hash seed.

- **Evidence**: AGENTS.md:1011-1017 confirms all three.

- **Rationale**: Tests that format dates ("Jan 15 2026") render differently across timezones. Locale affects string sorting. Hash seed affects dict iteration order (in CPython 3.7+ guaranteed, but seed=0 makes it explicit). Pinning all three eliminates a class of flakes.

- **TypeScript translation**: `TZ=UTC LANG=C.UTF-8 vitest`. Node doesn't have a hash-seed analog (`Math.random` is not seeded in the same way), but `Map`/`Set` iteration is insertion-ordered so this is less of an issue.

### AD-6: Change-detector tests are banned

- **Decision**: Tests that assert specific catalog entries, config version numbers, or enumeration counts are rejected in code review. Tests that assert *relationships* and *invariants* are kept.

- **Evidence**: AGENTS.md:1033-1077 has detailed examples. The rule:

  > if the test reads like a snapshot of current data, delete it. If it reads like a contract about how two pieces of data must relate, keep it.

  Examples of banned tests:

  ```python
  # catalog snapshot — breaks every model release
  assert "gemini-2.5-pro" in _PROVIDER_MODELS["gemini"]
  assert "MiniMax-M2.7" in models

  # config version literal — breaks every schema bump
  assert DEFAULT_CONFIG["_config_version"] == 21
  ```

  Examples of kept tests:

  ```python
  # behavior: does the catalog plumbing work at all?
  assert "gemini" in _PROVIDER_MODELS
  assert len(_PROVIDER_MODELS["gemini"]) >= 1

  # invariant: every model in the catalog has a context-length entry
  for m in _PROVIDER_MODELS["huggingface"]:
      assert m.lower() in DEFAULT_CONTEXT_LENGTHS_LOWER
  ```

- **Rationale**: Hermes ships catalog updates weekly (new models, version bumps). A test asserting `assert "gpt-5-5" in models` breaks every time. The fix isn't to update the test — that just hides the same problem next month. The fix is to assert what *must always be true*, regardless of specific entries.

- **TypeScript translation**: Same discipline. ESLint rule that flags hardcoded model names in tests.

### AD-7: Stress tests separate from main suite

- **Decision**: `tests/stress/` contains 10 files focused on concurrency edge cases. They run as part of `pytest -n 4` like everything else.

- **Evidence**: `wc -l tests/stress/*.py`:
  - `test_atypical_scenarios.py` 1060
  - `test_concurrency.py` 302
  - `test_concurrency_mixed.py` 350
  - `test_concurrency_parent_gate.py` 183
  - `test_concurrency_reclaim_race.py` 241
  - `test_property_fuzzing.py` 283
  - `test_subprocess_e2e.py` 228
  - `test_benchmarks.py` 221
  - `_fake_worker.py` 50 (helper)
  - `conftest.py` 37

- **Rationale**: Concurrency tests need different fixtures (real subprocesses, real SQLite, longer timeouts). Separating them lets the stress conftest add what they need without polluting the main suite.

- **TypeScript translation**: `tests/stress/` directory with its own setup. `pnpm test:stress` for focused runs.

### AD-8: `tests/conftest.py` autouse enforces points 1-4

- **Decision**: `conftest.py` independently enforces credential clearing, HOME redirection, TZ, locale — even if the wrapper script isn't used (IDE-launched pytest, etc.).

- **Evidence**: AGENTS.md:1017-1018:

  > `tests/conftest.py` also enforces points 1-4 as an autouse fixture so ANY pytest
  > invocation (including IDE integrations) gets hermetic behavior — but the wrapper
  > is belt-and-suspenders.

- **Rationale**: Defense in depth. A developer who runs pytest directly (via IDE) still gets hermetic isolation. The wrapper just adds the xdist + pytest-split layer.

- **TypeScript translation**: `vitest.setup.ts` autouse `beforeEach`. Same belt-and-suspenders.

### AD-9: Profile tests mock BOTH `Path.home` and `HERMES_HOME`

- **Decision**: Tests that touch profile features (per AGENTS.md:973-985) set both `Path.home()` (for profile discovery) and `HERMES_HOME` (for current-profile state).

- **Evidence**: AGENTS.md:976-984 (the `profile_env` fixture pattern):

  ```python
  @pytest.fixture
  def profile_env(tmp_path, monkeypatch):
      home = tmp_path / ".hermes"
      home.mkdir()
      monkeypatch.setattr(Path, "home", lambda: tmp_path)
      monkeypatch.setenv("HERMES_HOME", str(home))
      return home
  ```

- **Rationale**: Per doc 10 AD-6: profile operations are HOME-anchored, not HERMES_HOME-anchored. Two anchors, two mocks.

- **TypeScript translation**: Test helper that sets both `os.homedir` (mocked) and `THEOKIT_HOME` env var.

### AD-10: Real-LLM tests gated by explicit credentials

- **Decision**: Tests that actually hit a real LLM are not in the hermetic path. They run only when credentials are explicitly provided (and outside `run_tests.sh`).

- **Evidence**: `theokit-sdk/.claude/rules/real-llm-validation.md` — the *theokit-sdk* policy mirrors this. Validation requires explicit real-LLM keys; fixture mode doesn't count.

- **Rationale**: Real-LLM tests are slow, non-deterministic, and expensive. Running them in CI for every PR is wasteful. Gating them behind explicit credentials means they run only when intended.

- **TypeScript translation**: Per `.claude/rules/real-llm-validation.md` already in our project. Same discipline.

### AD-11: Property-based testing for concurrency invariants

- **Decision**: `tests/stress/test_property_fuzzing.py` (283 LoC) uses Hypothesis to fuzz concurrent operations against invariants ("no two claimers win the same task", "task_runs rowid parity").

- **Evidence**: File exists; size suggests substantial property tests.

- **Rationale**: Concurrency bugs have too many state combinations to enumerate manually. Property-based tests generate adversarial inputs and assert invariants hold across all of them.

- **TypeScript translation**: `fast-check` for property tests. Same patterns: generate operation sequences, run them concurrently, assert invariants.

### AD-12: pytest-split for sharding equivalence

- **Decision**: `pytest-split` is auto-installed if missing. Lets local runs match CI's per-shard execution time.

- **Evidence**: `scripts/run_tests.sh:54-60`:

  ```bash
  # ── Ensure pytest-split is installed (required for shard-equivalent runs) ──
  if ! "$PYTHON" -c "import pytest_split" 2>/dev/null; then
      echo "→ installing pytest-split into $VENV"
      ...
  ```

- **Rationale**: CI shards the test suite across N runners by historical execution time. Without pytest-split locally, you can't easily replicate a specific shard's run.

- **TypeScript translation**: Vitest has built-in sharding via `--shard 1/4` etc. No additional dep needed.

## Data structures

### Test layout (from `find tests -type d`)

```
tests/
├── conftest.py
├── acp/
├── acp_adapter/
├── agent/
├── cli/
├── cron/
├── e2e/
├── environments/
├── fakes/
├── gateway/
├── hermes_cli/
├── hermes_state/
├── honcho_plugin/
├── integration/
├── openviking_plugin/
├── plugins/
├── providers/
├── run_agent/
├── skills/
├── stress/
├── tools/
├── tui_gateway/
└── website/
```

Per-area test directories, mostly mirroring the production-code structure.

## Failure modes the testing discipline catches

1. **Snapshot tests breaking on routine updates** — banned outright.
2. **Local-CI drift from env vars** — wrapper unsets credentials.
3. **TZ-dependent date formatting** — TZ=UTC pin.
4. **Dict iteration order changes** — PYTHONHASHSEED=0.
5. **xdist worker count > 4 surfacing flakes** — hard cap.
6. **Tests writing to `~/.hermes/`** — autouse redirect.
7. **Test polluting next test's state** — fresh temp dir per test.
8. **Real LLM calls in CI from leaked dev env** — credential clearing.
9. **Concurrency bugs missed by single-threaded tests** — stress + property tests.
10. **Code-path-not-covered shipping** — combined unit + integration + stress.
11. **Test reads as snapshot of catalog** — code review enforcement.
12. **IDE-launched pytest bypasses wrapper** — conftest.py belt-and-suspenders.

## TypeScript test strategy proposal

### `package.json` scripts

```json
{
  "scripts": {
    "test": "cross-env TZ=UTC LANG=C.UTF-8 vitest run --pool=threads --pool-options.threads.maxThreads=4 --pool-options.threads.minThreads=4",
    "test:watch": "cross-env TZ=UTC vitest --pool=threads --pool-options.threads.maxThreads=4",
    "test:stress": "vitest run tests/stress",
    "test:real-llm": "vitest run tests/real-llm  // gated by explicit env"
  }
}
```

### `vitest.setup.ts`

```typescript
import { beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const CREDENTIAL_ENV_PREFIXES = ["_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_CREDENTIALS"];
const PROVIDER_KEYS = [
  "OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY", "GOOGLE_API_KEY", /* … */
];

let originalEnv: Record<string, string | undefined>;
let theokitHome: string;

beforeEach(async () => {
  // Snapshot env
  originalEnv = { ...process.env };

  // Clear credential vars
  for (const key of Object.keys(process.env)) {
    if (CREDENTIAL_ENV_PREFIXES.some(p => key.endsWith(p))) {
      delete process.env[key];
    }
  }
  for (const key of PROVIDER_KEYS) delete process.env[key];

  // Set hermetic THEOKIT_HOME
  theokitHome = path.join(os.tmpdir(), `theokit-test-${randomUUID()}`);
  await fs.mkdir(theokitHome, { recursive: true });
  process.env.THEOKIT_HOME = theokitHome;

  // Pin TZ and locale
  process.env.TZ = "UTC";
  process.env.LANG = "C.UTF-8";
});

afterEach(async () => {
  await fs.rm(theokitHome, { recursive: true, force: true });
  process.env = originalEnv;
});
```

### Disciplines to adopt

1. **`pnpm test` is the only sanctioned entrypoint.**
2. **Vitest autouse fixture clears credentials + redirects `THEOKIT_HOME`.**
3. **No change-detector tests.** Document the rule in `.claude/quality-gates.md`.
4. **Property tests via `fast-check`** for concurrency invariants (kanban claim race, FTS index parity, etc.).
5. **Real-LLM tests** in a separate directory, gated by env.
6. **Coverage report** as a CI gate but NOT as a hard threshold (Hermes doesn't have a coverage gate; we shouldn't either — coverage as metric, not target).

## Open questions

- **`pytest-split` equivalent for Vitest**: Vitest sharding is built-in via `--shard`. Verify it's deterministic.
- **Mock LLM strategy**: `fixture-responder` in our codebase. Hermes uses similar fixtures. Document the pattern for plugin authors.
- **Stress test runtime**: 10 files × ~30s each = 5 min. Worth running on every PR? Recommend: run only on `main` branch CI; per-PR runs only on relevant areas.

## References

- `referencia/hermes-agent/scripts/run_tests.sh:1-129`
- `referencia/hermes-agent/tests/conftest.py:1-965`
- `referencia/hermes-agent/tests/stress/*.py`
- AGENTS.md:988-1080 — Testing section (the whole thing)
- Theokit rules:
  - `.claude/rules/no-stubs-no-mocks-no-wired.md`
  - `.claude/rules/real-llm-validation.md`
