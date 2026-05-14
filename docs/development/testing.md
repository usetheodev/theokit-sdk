# Testing

We use [Vitest 3](https://vitest.dev) for unit and integration tests. The smoke test in `packages/sdk/tests/smoke.test.ts` is the reference pattern.

## Running tests

```bash
pnpm test                     # one-shot run
pnpm test:watch               # watch mode
pnpm -w run validate          # full pipeline (includes tests)
```

Tests live in `packages/sdk/tests/`. The Vitest config (`packages/sdk/vitest.config.ts`) picks up `tests/**/*.test.ts`.

## What we test

| Test type | Where | What to cover |
| --- | --- | --- |
| **Smoke** | `tests/smoke.test.ts` | Public API surface is importable; stubs reject with the right error type. |
| **Golden** | `tests/golden/*.golden.test.ts` + `tests/golden/**/*.json` | Frozen, normalized snapshots of public outputs (agent metadata, run results, stream events, cron jobs, errors). Drive TDD for the runtime adapters. |
| **Contract** | `tests/contract/*.contract.test.ts` | Behavioral contracts of public methods — argument validation, error mapping, runtime detection, HTTP protocol. |
| **Unit** | `tests/<feature>.test.ts` | Pure logic — error class shape, env var resolution, ID prefix detection, cron expression parsing. |
| **Integration** | `tests/integration/*.test.ts` (when added) | Runtime adapters against real backends, hitting `THEOKIT_API_KEY` if present. Skipped by default. |
| **Types** | `tests/types/*.test-d.ts` (when added) | `expectTypeOf` assertions on public type contract. |

### Golden tests in detail

Goldens normalize non-deterministic fields (IDs, timestamps, `/tmp` paths, PR URLs, API keys) and compare to a frozen JSON file. The hygiene test (`tests/golden/hygiene.golden.test.ts`) sweeps every `tests/golden/**/*.json` and enforces:

- Every golden carries a public contract signal (`type`, `status`, `name`, `agentId`, `runtime`, `capability`, etc. — see `tests/helpers/contract-signal.ts`).
- No raw UUIDs, ISO timestamps, secret-looking keys (`apiKey`, `token`, `secret`, …), or absolute temp paths.
- Tool call `args`/`result` are normalized to `<unknown>` (tool payloads are NOT part of the stable schema).
- Files are byte-stable — Biome is configured to ignore them so `pnpm check:fix` cannot reformat goldens.

Add a new golden by writing a `*.golden.test.ts` that calls a public API, passes the result through `normalizeForGolden(...)`, and `expect(normalized).toEqual(imported-JSON)`. Then commit the matching JSON under `tests/golden/<area>/`.

### Determinism dependency for stream goldens

`stream.golden.test.ts` asserts a specific sequence of `SDKMessage` types (including `task` and `request`). For this to be reproducible, the local runtime adapter MUST expose a deterministic LLM-mock mode when invoked from tests. The `tests/helpers/local-http-server.ts` helper exists for this purpose — runtime adapters should route through an injectable `fetch` (see `docs.md` HTTP client contract) so tests can plug it in.

Until that mock is wired up, the stream goldens are intentionally RED. Do not "fix" them by relaxing the assertion — the assertion is the spec.

### Updating a golden

1. Make the public-API change.
2. Re-run the affected test. It will fail with a diff.
3. Verify the new output is correct (manual review — goldens are reviewed in PR, not auto-generated blindly).
4. Update the JSON file to match. The hygiene test will catch unsafe leakage automatically.
5. Add a `CHANGELOG.md` entry. Goldens ARE part of the public contract — updating them is a user-visible change.

## Vitest patterns

### Standard test shape

```typescript
import { describe, expect, it } from "vitest";
import { TheokitAgentError } from "../src/errors.js";

describe("TheokitAgentError", () => {
  it("carries isRetryable, code, protoErrorCode, and cause", () => {
    const cause = new Error("upstream");
    const err = new TheokitAgentError("boom", {
      isRetryable: true,
      code: "BOOM_001",
      protoErrorCode: "proto/boom",
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.isRetryable).toBe(true);
    expect(err.code).toBe("BOOM_001");
    expect(err.cause).toBe(cause);
  });
});
```

### Async rejection

```typescript
it("rejects with ConfigurationError until implemented", async () => {
  await expect(Cron.create({ cron: "0 9 * * *", message: "hi" }))
    .rejects.toBeInstanceOf(ConfigurationError);
});
```

### Imports

Inside `tests/`, import from `../src/index.js` (relative path with `.js` extension — required by `verbatimModuleSyntax`).

## TDD workflow

1. Write a failing test first.
2. Run `pnpm test:watch` — watch it fail.
3. Implement the smallest change that makes the test pass.
4. Refactor if needed; re-run.
5. Repeat for the next slice.

For bug fixes specifically: **always** add a regression test BEFORE the fix lands. The test should fail on the bug-present code and pass on the fix.

## Coverage

Vitest's V8 coverage is configured in `vitest.config.ts`. Run with:

```bash
pnpm --filter=@usetheo/sdk exec vitest run --coverage
```

We don't currently enforce a coverage threshold — focus on critical paths first. Once the runtime adapters ship, we'll set a floor.

## Type-only tests

When the runtime adapters land, add type assertions to catch contract drift:

```typescript
// tests/types/agent.test-d.ts
import { expectTypeOf } from "vitest";
import type { Agent, AgentOptions } from "../../src/index.js";

expectTypeOf<Parameters<typeof Agent.create>[0]>().toEqualTypeOf<AgentOptions>();
```

## Integration tests against real backends

Mark integration tests with a `.integration.test.ts` suffix and skip them by default in `vitest.config.ts`. Run explicitly when needed:

```bash
THEOKIT_API_KEY=... pnpm --filter=@usetheo/sdk exec vitest run tests/integration
```

Never commit real API keys. Use a local `.env` (gitignored) or your CI's secrets store.

## Next

- [Conventions](./conventions.md) — code style alongside tests
- [Releasing](./releasing.md) — Changesets workflow
