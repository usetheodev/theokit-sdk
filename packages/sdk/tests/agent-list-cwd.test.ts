/**
 * M107 T1.3 — `Agent.list` starts READING the `cwd` its type already promises.
 *
 * ## The defect, and why it is expensive
 *
 * `ListAgentsOptions` has declared `{ runtime: "local"; cwd?: string }` all along, but `Agent.list`
 * hydrated `hydrateRegistryFromDisk(process.cwd())` with a **fixed** `cwd` and returned the whole map in
 * memory. That is: `Agent.list({ runtime: "local", cwd: "/other/project" })` **compiled and was
 * silently ignored** — a magic value instead of an error
 * (`.claude/rules/error-handling.md § 2`).
 *
 * The consequence is not cosmetic. The listing feeds `activeKnown` in the consumer's session
 * collector, which is one of the five NEVER-delete guards in
 * `.claude/rules/audit-trail-rotation.md`, on a path that calls `unlink`. Because hydration was
 * fixed, the guard reached **one** project — measured: 1 of 10,982 — and the rule has declared that
 * residue in writing for two milestones. Honoring `cwd` is what closes the guard; no consumer-side
 * fix could, because reimplementing the registry read on a destructive path is exactly what
 * Unbreakable Rule 9 forbids.
 *
 * ## The filter's rule is the SAME as persistence's (EC-7 — completeness, not just correctness)
 *
 * `cwd` is **optional** on `RegisteredAgent`, and `resolveRegistryCwd` already resolves its absence
 * to `process.cwd()` — that is how an entry is ROUTED to a file on disk. The filter reuses exactly
 * that function, not `agent.cwd === cwd`. The difference matters: with the naive comparison, every
 * entry without a `cwd` would vanish from the listing of the process's own directory, and an entry
 * that vanishes from `activeKnown` is an entry the collector stops protecting.
 * `test_an_entry_without_cwd_belongs_to_the_process_cwd` is that assertion.
 *
 * ## Decision on `cursor` and `limit` (plan Q5) — they do NOT land, and not one without the other
 *
 * The open question was whether the cursor's shape "fits in one sentence". It does — *"the cursor is
 * the `agentId` of the page's last item, and the next page is what comes after it in the stable
 * order"* — but the final clause is the problem: **no stable order exists today**.
 * `listRegisteredAgents` returns a `Map`'s insertion order, which varies with hydration order.
 * Imposing `ORDER BY agentId` would change the order observed by **every** current caller, which is
 * not additive and does not fit in a minor.
 *
 * And `limit` cannot land alone: `limit` without `nextCursor` is **silent truncation** — exactly
 * the latent trap the consumer's `CursorNotDrainedError` exists to catch, and on a path
 * that deletes files. Shipping half a pagination would trade "ignored parameter" for "a partial page
 * presented as the complete population", which is strictly worse.
 *
 * Nothing is waiting on them: the consumer does not pass `limit` (the layer's type still closes it)
 * and the item measured as actionable is `cwd`. Parsimony rung 1 — what need not exist now is not
 * written now. **Declared residue:** the layer's `limit`/`cursor` narrowing block still holds and
 * needs its own assertion citing its exit criterion (EC-14),
 * Phase 2 work of this plan.
 *
 * ## Why this file is NOT `tests/contract/agent-management.contract.test.ts`
 *
 * The plan names that file, and the acceptance criterion says to run `npx vitest run
 * packages/sdk/tests/contract/agent-management.contract.test.ts` returning 0. When this file was
 * written that command returned 1: `vitest.config.ts` excluded `tests/contract/**` wholesale, so the
 * output was literally `No test files found, exiting with code 1`, and writing the lock there would
 * have produced a gate that never runs at the real checkpoint.
 *
 * **The MECHANISM changed and the conclusion did not, which is why this paragraph is worth keeping
 * accurate rather than deleting.** There is no longer a blanket `tests/contract/**` exclusion — it
 * was replaced by `ROADMAP_ONLY_SUITES`, a named list of three files, so most of that directory now
 * runs in the default gate. `agent-management.contract.test.ts` is one of the three, so the command
 * the acceptance criterion names still returns 1, for a narrower reason than the one first recorded.
 *
 * This file stays where it is. It is collected by the default `include` either way, and the lock it
 * carries has to run at `pnpm test` to be worth anything.
 *
 * ## The race this file FOUND (did not predict)
 *
 * `test_two_simultaneous_hydrations_of_the_same_cwd_do_not_duplicate_entries` stayed red after
 * `Agent.list` already honoring `cwd`, and the reason is a **pre-existing** defect:
 * `hydrateRegistryFromDisk` marked the `cwd` hydrated BEFORE awaiting the disk read, so the second
 * concurrent call saw the marker and returned immediately — listing a still-empty registry. The
 * symptom is not a duplicated entry, which is what the plan feared; it is a **missing** entry, which
 * is the dangerous side in a consumer whose listing feeds `activeKnown`. The fix was to memoize the
 * PROMISE, not the flag.
 *
 * ## Mutation counter-proof (EXECUTED; the column is what fell, not what was predicted)
 *
 * | # | Mutation | Fell | Tests that died |
 * |---|---|---|---|
 * | D | `agent.ts`: `hydrateRegistryFromDisk(cwd)` -> `(process.cwd())` | 4/6 | foreign, non-contamination, and both concurrency ones |
 * | E | `agent-registry.ts`: `listRegisteredAgents` ignores the `cwd` parameter | 3/6 | non-contamination, `without_cwd`, concurrency across different cwds |
 * | F | `agent-registry.ts`: `agent.cwd === cwd` instead of `resolveRegistryCwd` | 1/6 | `test_an_entry_without_cwd_belongs_to_the_process_cwd` (EC-7) |
 * | G | `agent-registry.ts`: memoize the flag before the `await`, as it was | 1/6 | `test_two_simultaneous_hydrations_of_the_same_cwd_do_not_duplicate_entries` |
 *
 * F and G kill **one test each, and the right one** — they are the two assertions no other covers.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../src/index.js";
import {
  clearAgentRegistry,
  flushRegistrySaves,
  registerAgent,
  removeRegisteredAgent,
} from "../src/internal/runtime/registry/agent-registry.js";
import type { RegisteredAgent } from "../src/internal/runtime/registry/agent-registry-contract.js";

/** A minimal registry entry — `agent-*` is the prefix that marks it local. */
function entry(agentId: string, cwd?: string): RegisteredAgent {
  return {
    agentId,
    runtime: "local",
    createdAt: 1,
    lastModified: 1,
    archived: false,
    options: {},
    ...(cwd === undefined ? {} : { cwd }),
  };
}

/** Registers in memory AND waits for the disk write of that `cwd`. */
async function persist(agentId: string, cwd: string): Promise<void> {
  registerAgent(entry(agentId, cwd));
  await flushRegistrySaves(cwd);
}

const ids = (r: { items: { agentId: string }[] }): string[] => r.items.map((i) => i.agentId);

let projects: string[] = [];

function project(): string {
  const p = mkdtempSync(join(tmpdir(), "m107-list-cwd-"));
  projects.push(p);
  return p;
}

beforeEach(() => {
  clearAgentRegistry();
});

afterEach(async () => {
  // `agent-without-cwd` is routed to `process.cwd()`, that is, to THIS repository's own registry
  // (`packages/sdk/.theokit/agents/registry.json`, gitignored). Leaving it there would contaminate any
  // a future test listing the process cwd — the kind of shared state the EC-7 note in
  // `vitest.config.ts` requires each test to clean up after itself.
  removeRegisteredAgent("agent-without-cwd");
  await flushRegistrySaves();
  clearAgentRegistry();
  for (const p of projects) rmSync(p, { recursive: true, force: true });
  projects = [];
});

describe("M107 T1.3 — Agent.list honours the cwd the type promises", () => {
  it("test_list_with_a_foreign_cwd_returns_that_cwds_entries", async () => {
    // Arrange — the entry exists ON DISK in a project that is not the process's, and the in-memory
    // registry is cleared. Without clearing, the entry would come back from memory and the test would
    // pass by accident.
    const otherProject = project();
    await persist("agent-foreign", otherProject);
    clearAgentRegistry();

    // Act
    const r = await Agent.list({ runtime: "local", cwd: otherProject });

    // Assert — today returns `[]`: this is the test that fails BEFORE and the one that closes the declared guard.
    expect(ids(r)).toContain("agent-foreign");
  });

  it("test_list_of_a_nonexistent_cwd_returns_an_empty_list_without_throwing", async () => {
    // Arrange — NEGATIVE CASE. A project with no registry and a project deleted from disk are the
    // same outcome, and the session collector DEPENDS on this not throwing.
    const nonexistent = join(tmpdir(), "m107-does-not-exist-at-all-xyz");

    // Act
    const r = await Agent.list({ runtime: "local", cwd: nonexistent });

    // Assert
    expect(r.items).toEqual([]);
  });

  it("test_listing_a_foreign_cwd_does_not_contaminate_another_cwds_listing", async () => {
    // Arrange — the task's GUARD INVARIANT. The in-memory map is process-global, so hydrating a
    // foreign `cwd` dumps its entries into that map. If the listing did not filter, project B would
    // start "having" project A's sessions — and this is `activeKnown`, in a guard on
    // NEVER-delete guard, which would consume this.
    const projectA = project();
    const projectB = project();
    await persist("agent-only-in-A", projectA);
    await persist("agent-only-in-B", projectB);
    clearAgentRegistry();

    // Act — order matters: A first, so its entries are in the map when B is read.
    await Agent.list({ runtime: "local", cwd: projectA });
    const b = await Agent.list({ runtime: "local", cwd: projectB });

    // Assert
    expect(ids(b)).toContain("agent-only-in-B");
    expect(ids(b), "project A entries leaked into project B's listing").not.toContain(
      "agent-only-in-A",
    );
  });

  it("test_an_entry_without_cwd_belongs_to_the_process_cwd", async () => {
    // Arrange — EC-7, the COMPLETENESS half. `cwd` is optional on `RegisteredAgent`, and its absence already
    // means `process.cwd()` for on-disk ROUTING purposes. The filter has to use the same
    // rule, or every entry without a `cwd` would vanish from its own project's listing.
    const otherProject = project();
    registerAgent(entry("agent-without-cwd"));

    // Act
    const fromProcess = await Agent.list({ runtime: "local" });
    const fromOther = await Agent.list({ runtime: "local", cwd: otherProject });

    // Assert
    expect(
      ids(fromProcess),
      "an entry with no cwd vanished from the process-cwd listing",
    ).toContain("agent-without-cwd");
    expect(ids(fromOther)).not.toContain("agent-without-cwd");
  });

  it("test_two_simultaneous_hydrations_of_the_same_cwd_do_not_duplicate_entries", async () => {
    // Arrange — atomic-counter invariant over the per-`cwd` memoization guard
    // (`agent-registry.ts`: `hydratedCwds`). Hydrating an arbitrary `cwd` multiplies the
    // combinations, and that is where a race would produce a duplicated entry.
    const projectA = project();
    await persist("agent-double", projectA);
    clearAgentRegistry();

    // Act
    const [a, b] = await Promise.all([
      Agent.list({ runtime: "local", cwd: projectA }),
      Agent.list({ runtime: "local", cwd: projectA }),
    ]);

    // Assert (happens-before observation, after the barrier)
    expect(ids(a).filter((i) => i === "agent-double")).toHaveLength(1);
    expect(ids(b).filter((i) => i === "agent-double")).toHaveLength(1);
  });

  it("test_simultaneous_hydrations_of_DIFFERENT_cwds_do_not_mix", async () => {
    // Arrange — the same non-contamination, now without the sequential barrier that would hide it.
    const projectA = project();
    const projectB = project();
    await persist("agent-concurrent-A", projectA);
    await persist("agent-concurrent-B", projectB);
    clearAgentRegistry();

    // Act
    const [a, b] = await Promise.all([
      Agent.list({ runtime: "local", cwd: projectA }),
      Agent.list({ runtime: "local", cwd: projectB }),
    ]);

    // Assert
    expect(ids(a)).toEqual(["agent-concurrent-A"]);
    expect(ids(b)).toEqual(["agent-concurrent-B"]);
  });
});
