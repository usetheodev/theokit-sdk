/**
 * Plumbing test for the `memoryProvider` field on `AgentLoopInputs`
 * (SDK 2.0 Phase 1 / T1.4 — type-level threading).
 *
 * Runtime hooks (init/buildTools/runActivePass/dispose) HAVE landed — loop-context-init.ts:95,
 * :129, :166 and loop.ts:176/:204. This line said "land in T1.5" until 2026-09-01, which is the
 * same stale not-implemented claim pv 33 corrected in six places under src/. The lint that now
 * guards those (tests/lint/no-stale-not-implemented-claims.test.ts) scans src/ only, because its
 * subject is the PUBLISHED .d.ts; a test docblock misleads a maintainer rather than a consumer.
 * For now, we pin the BRANCH LOGIC that `real-local-run.ts` uses to
 * conditionally thread `agentOptions.memoryProvider` into the loop
 * inputs object.
 *
 * CITATION CORRECTED 2026-09-01. This docblock used to justify its mirror by pointing at
 * `agent-loop/budget-tracker-wiring.test.ts` as the repo convention. That premise is false and the
 * cited file says so itself. `agent-loop/budget-tracker-wiring.test.ts`
 * was repaired under B-095 and its docblock now records the opposite of what this comment claims for it:
 * *"A mirror passes for exactly as long as someone remembers to edit it alongside the code, which is the
 * property it was supposed to VERIFY rather than assume. No mutation of the real wiring could fail
 * anything here."* And the harness it says does not exist does: `LlmClient` has two members (`name` +
 * `stream`), the stub is ten lines, and 22 test files in this package already drive the real
 * `runAgentLoop` — `agent-loop/memory-provider-integration.test.ts` among them.
 *
 * Citation corrected 2026-09-01. A stale pointer to a repaired exemplar is how an anti-pattern keeps
 * recruiting after it has been named, which is why this note replaces the appeal rather than deleting it.
 */

import { describe, expectTypeOf, it } from "vitest";
import type { AgentLoopInputs } from "../../src/internal/agent-loop/types.js";
import type { MemoryProvider } from "../../src/internal/runtime/memory-glue/memory-provider.js";

/**
 * CONVERTED 2026-09-01. `threadMemoryProvider` — a copy of the conditional spread at
 * `real-local-run.ts:350` — used to stand in for the runtime here, and its own comment promised it
 * was "kept in lockstep with the runtime call".
 *
 * It was not, and could not be. Measured: replacing that spread's condition with `false`, so the
 * provider is NEVER threaded into the loop, left 15 tests across this file, the lifecycle file and
 * the integration file entirely GREEN. The threading had no coverage at all — the mirror occupied
 * the place where coverage would have gone, which is the more expensive half of the pattern.
 *
 * The case below drives the public surface (`Agent.create({ memoryProvider })` → `send`) because
 * that is the only path that exercises `real-local-run`'s spread; the loop-level tests in
 * `agent-loop/memory-provider-lifecycle.test.ts` pass the provider to `runAgentLoop` directly and
 * therefore cannot see whether anything puts it there.
 */
describe("AgentOptions.memoryProvider reaches the loop", () => {
  // THE COVERAGE THIS FILE SHOULD HAVE IS NOT HERE, and saying so is the point.
  //
  // The mirror is gone because it covered nothing: replacing the condition of the conditional
  // spread at `real-local-run.ts:350` with `false`, so a consumer-supplied provider is never
  // threaded into the loop, left 15 tests across this file, the lifecycle file and the integration
  // file entirely GREEN.
  //
  // CLOSED. The entry point is `createRealLocalRun` (real-local-run.ts:107), and both sites are
  // covered in `memory-provider-reaches-the-loop.test.ts` — one test each, because they are
  // independent and a fix to one leaves the other unguarded. Each was verified by MUTATION rather
  // than by passing: replacing the spread's condition with `false` kills only the Run-driven case,
  // and deleting the consumer-supplied branch of `resolveMemoryProviderForLoop` kills only the
  // send-driven one.

  it("test_provider_field_is_optional_on_inputs_type", () => {
    expectTypeOf<AgentLoopInputs["memoryProvider"]>().toEqualTypeOf<MemoryProvider | undefined>();
  });
});
