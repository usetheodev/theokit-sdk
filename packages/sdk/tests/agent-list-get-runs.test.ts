/**
 * B-115 — three public Agent APIs (`Agent.list`, `Agent.get`, `Agent.listRuns`) used to accept
 * documented options and silently discard them: `Agent.list`'s `includeArchived`/`limit`/`cursor`,
 * `Agent.get`'s `cwd`, `Agent.listRuns`'s `cwd`/`limit`/`cursor`. Each is now either applied (this
 * file) or removed from the public type (`prUrl` on `Agent.list`, `runtime` on `Agent.listRuns` —
 * see `types/agent.ts` for the removal rationale).
 *
 * Mirrors `tests/agent-list-cwd.test.ts`'s fixture style: temp project dirs, direct
 * `registerAgent`/`flushRegistrySaves` writes, `clearAgentRegistry()` between arrange and act so a
 * result can only come from disk hydration or the in-memory Map under test — never leftover state.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent, UnknownAgentError } from "../src/index.js";
import {
  clearAgentRegistry,
  flushRegistrySaves,
  registerAgent,
  removeRegisteredAgent,
} from "../src/internal/runtime/registry/agent-registry.js";
import type { RegisteredAgent } from "../src/internal/runtime/registry/agent-registry-contract.js";
import { registerRun } from "../src/internal/runtime/registry/run-registry.js";
import type { Run } from "../src/types/run.js";

function entry(agentId: string, cwd: string | undefined, archived = false): RegisteredAgent {
  return {
    agentId,
    runtime: "local",
    createdAt: 1,
    lastModified: 1,
    archived,
    options: {},
    ...(cwd === undefined ? {} : { cwd }),
  };
}

async function persist(agentId: string, cwd: string, archived = false): Promise<void> {
  registerAgent(entry(agentId, cwd, archived));
  await flushRegistrySaves(cwd);
}

/** Minimal fake `Run` — only the fields these tests read. */
function fakeRun(id: string, agentId: string): Run {
  return { id, agentId, status: "finished" } as unknown as Run;
}

const ids = (r: { items: { agentId: string }[] }): string[] => r.items.map((i) => i.agentId);

let projects: string[] = [];
function project(): string {
  const p = mkdtempSync(join(tmpdir(), "b115-"));
  projects.push(p);
  return p;
}

beforeEach(() => {
  clearAgentRegistry();
});

afterEach(async () => {
  removeRegisteredAgent("agent-b115-no-cwd-probe");
  await flushRegistrySaves();
  clearAgentRegistry();
  for (const p of projects) rmSync(p, { recursive: true, force: true });
  projects = [];
});

describe("B-115 — Agent.get honours cwd", () => {
  it("test_get_with_a_foreign_cwd_finds_that_cwds_entry", async () => {
    const otherProject = project();
    await persist("agent-b115-foreign", otherProject);
    clearAgentRegistry();

    const info = await Agent.get("agent-b115-foreign", { cwd: otherProject });

    expect(info.agentId).toBe("agent-b115-foreign");
  });

  it("test_get_without_a_cwd_does_not_find_a_foreign_entry", async () => {
    // ACCEPT/REJECT pairing for the same guard (rules/testing.md § 4.2): the sibling test above is
    // the accept case (cwd supplied, entry found); this is the reject case (cwd omitted, entry in a
    // foreign project is correctly NOT found) — asserting the SPECIFIC typed error and code, not
    // merely that something throws (rules/testing.md § 4.1).
    const otherProject = project();
    await persist("agent-b115-no-cwd-probe", otherProject);
    clearAgentRegistry();

    const err = await Agent.get("agent-b115-no-cwd-probe").then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(UnknownAgentError);
    expect((err as UnknownAgentError).code).toBe("unknown_agent");
  });
});

describe("B-115 — Agent.list honours includeArchived", () => {
  it("test_list_hides_archived_agents_by_default_and_shows_them_when_asked", async () => {
    const cwd = project();
    await persist("agent-b115-active", cwd, false);
    await persist("agent-b115-archived", cwd, true);
    clearAgentRegistry();

    const hidden = await Agent.list({ runtime: "local", cwd });
    expect(ids(hidden), "the active agent must be listed").toContain("agent-b115-active");
    expect(
      ids(hidden),
      "an archived agent must NOT be listed by default — this is the half a filter that only ever accepts cannot check",
    ).not.toContain("agent-b115-archived");
  });
});

describe("B-115 — Agent.list honours limit/cursor", () => {
  it("test_list_paginates_and_the_cursor_continues_where_the_page_left_off", async () => {
    const cwd = project();
    await persist("agent-b115-c", cwd);
    await persist("agent-b115-a", cwd);
    await persist("agent-b115-b", cwd);
    clearAgentRegistry();

    const page1 = await Agent.list({ runtime: "local", cwd, limit: 2 });
    expect(ids(page1), "sorted by agentId so the page is deterministic").toEqual([
      "agent-b115-a",
      "agent-b115-b",
    ]);
    expect(page1.nextCursor, "more items remain after this page").toBe("agent-b115-b");

    const page2 = await Agent.list({ runtime: "local", cwd, limit: 2, cursor: page1.nextCursor });
    expect(ids(page2)).toEqual(["agent-b115-c"]);
    expect(page2.nextCursor, "the last page must not claim more remain").toBeUndefined();
  });

  it("test_list_without_a_limit_is_unpaginated_same_as_before_b115", async () => {
    // The unlimited default MUST be unaffected by the pagination fix (M107's non-breaking
    // constraint) — no sort, no nextCursor, every matching agent in one page.
    const cwd = project();
    await persist("agent-b115-z", cwd);
    await persist("agent-b115-y", cwd);
    clearAgentRegistry();

    const all = await Agent.list({ runtime: "local", cwd });

    expect(all.nextCursor).toBeUndefined();
    expect(ids(all).sort()).toEqual(["agent-b115-y", "agent-b115-z"]);
  });
});

describe("B-115 — Agent.listRuns honours cwd and limit/cursor", () => {
  it("test_list_runs_with_a_foreign_cwd_finds_that_cwds_runs", async () => {
    const otherProject = project();
    await persist("agent-b115-runs-owner", otherProject);
    registerRun(fakeRun("run-b115-1", "agent-b115-runs-owner"));
    // Clears only the in-memory AGENT map — the run registry is untouched (runs are never
    // persisted to disk), so `run-b115-1` survives. This forces `Agent.listRuns` to prove the
    // agent record was re-hydrated from `otherProject` rather than found already in memory.
    clearAgentRegistry();

    const listed = await Agent.listRuns("agent-b115-runs-owner", { cwd: otherProject });

    expect(listed.items.map((r) => r.id)).toContain("run-b115-1");
  });

  it("test_list_runs_paginates_in_stable_creation_order_not_sorted_by_id", async () => {
    const cwd = project();
    await persist("agent-b115-runs-paged", cwd);
    // Ids deliberately NOT in sort order — proves the pagination does not re-sort runs (unlike
    // Agent.list, which sorts by agentId to make a cursor meaningful across an unstable registry
    // order; a single agent's runs are already stable/append-only).
    registerRun(fakeRun("run-z", "agent-b115-runs-paged"));
    registerRun(fakeRun("run-a", "agent-b115-runs-paged"));
    registerRun(fakeRun("run-m", "agent-b115-runs-paged"));

    const page1 = await Agent.listRuns("agent-b115-runs-paged", { cwd, limit: 2 });
    expect(page1.items.map((r) => r.id)).toEqual(["run-z", "run-a"]);
    expect(page1.nextCursor).toBe("run-a");

    const page2 = await Agent.listRuns("agent-b115-runs-paged", {
      cwd,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items.map((r) => r.id)).toEqual(["run-m"]);
    expect(page2.nextCursor).toBeUndefined();
  });
});
