/**
 * B-002 — `local-agent-lifecycle.ts`: the writer lease and the dispose teardown.
 *
 * Before this file the module read 17/22 lines with `reloadLocalAgent` at
 * `FNDA:0`, and — more importantly — nothing asserted the two decisions the
 * source spends its comments defending: that `SessionBusyError` PROPAGATES while
 * every other lease failure is swallowed, and that disk writes are flushed
 * BEFORE the store hands the lease back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("../../../src/internal/local-agent/real-local-run.js", () => ({
  disposeSessionMcpClients: (agentId: string) => {
    hoisted.order.push(`disposeSessionMcpClients:${agentId}`);
  },
}));

vi.mock("../../../src/internal/session/index.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    flushSessionWrites: () => {
      hoisted.order.push("flushSessionWrites");
      return Promise.resolve();
    },
  };
});

vi.mock("../../../src/internal/runtime/registry/agent-registry.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    flushRegistrySaves: (cwd: string) => {
      hoisted.order.push(`flushRegistrySaves:${cwd}`);
      return Promise.resolve();
    },
  };
});

vi.mock("../../../src/internal/session/agent-session.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    discardSession: (cwd: string, agentId: string) => {
      hoisted.order.push(`discardSession:${cwd}:${agentId}`);
      return 0;
    },
  };
});

import { setDiagnosticsSink } from "../../../src/internal/diagnostics.js";
import type {
  LocalAgentDisposeTarget,
  LocalAgentReloadTarget,
} from "../../../src/internal/local-agent/local-agent-lifecycle.js";
import {
  acquireLeaseIfPossible,
  disposeLocalAgentSession,
  releaseLeaseIfPossible,
  reloadLocalAgent,
} from "../../../src/internal/local-agent/local-agent-lifecycle.js";
import { SessionBusyError } from "../../../src/internal/persistence/session-writer.js";
import type { AgentDefinition, AgentOptions } from "../../../src/types/agent.js";
import type { SessionStore } from "../../../src/types/session-store.js";

/** Messages the SDK emitted on its diagnostics channel during one test. */
let diagnostics: string[] = [];

beforeEach(() => {
  hoisted.order.length = 0;
  diagnostics = [];
  setDiagnosticsSink((message) => diagnostics.push(message));
});

afterEach(() => {
  setDiagnosticsSink(undefined);
  vi.unstubAllEnvs();
});

/**
 * A minimal complete `SessionStore`, with the optional lifecycle members left off.
 *
 * The cases below used to pass partial object literals, which typechecked only because the probes
 * took `unknown`. `acquire` / `release` / `dispose` are DECLARED optional members now, so the
 * parameter is `SessionStore` and a partial literal no longer compiles — which is the improvement,
 * not an obstacle: the SDK never receives a store missing `readRecords`.
 */
function storeWith(extra: Partial<SessionStore> = {}): SessionStore {
  return {
    readRecords: () => Promise.resolve([]),
    appendRecords: () => Promise.resolve(),
    ...extra,
  };
}

describe("acquireLeaseIfPossible", () => {
  it("takes the lease for the agent id when the store can take one", async () => {
    const taken: string[] = [];
    const store = storeWith(
      storeWith({
        acquire: (id: string) => {
          taken.push(id);
          return Promise.resolve();
        },
      }),
    );

    await acquireLeaseIfPossible(store, "agent-1");

    expect(taken).toEqual(["agent-1"]);
  });

  it("stays SILENT for a store that declares no acquire (the two-method port)", async () => {
    // Not merely "does not throw". Without the capability probe, `a.call(...)` on
    // `undefined` raises a TypeError inside the existing try/catch, which reports
    // it as a lease failure — so every external store with no lease would emit
    // "writer lease unavailable" on every init. Resolving is not the oracle; the
    // silent diagnostics channel is.
    await expect(acquireLeaseIfPossible(storeWith(), "agent-1")).resolves.toBeUndefined();

    expect(diagnostics).toEqual([]);
  });

  it("does not reach into a non-callable `acquire` property", async () => {
    // A store whose `acquire` is an object carrying its own `call`. The probe
    // rejects it on `typeof`; without the probe, `a.call(store, id)` invokes that
    // foreign function — the SDK calling arbitrary consumer code it never checked.
    let reached = 0;
    const store = storeWith({
      // Deliberately not a function: the cast is the point of the case, and the probe must reject it
      // on `typeof` rather than reaching for its `call`.
      acquire: {
        call: () => {
          reached += 1;
        },
      } as never,
    });

    await expect(acquireLeaseIfPossible(store, "agent-1")).resolves.toBeUndefined();

    expect(reached).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it("PROPAGATES SessionBusyError — another process holds the session", async () => {
    const busy = new SessionBusyError("/tmp/x.jsonl held by pid 42");
    const store = storeWith(storeWith({ acquire: () => Promise.reject(busy) }));

    await expect(acquireLeaseIfPossible(store, "agent-1")).rejects.toBeInstanceOf(SessionBusyError);
  });

  it("PROPAGATES any error merely NAMED SessionBusyError (cross-realm store impls)", async () => {
    const impostor = Object.assign(new Error("held"), { name: "SessionBusyError" });
    const store = storeWith(storeWith({ acquire: () => Promise.reject(impostor) }));

    await expect(acquireLeaseIfPossible(store, "agent-1")).rejects.toBe(impostor);
  });

  it("swallows a non-contention I/O failure and proceeds without the lease", async () => {
    // A read-only directory (EACCES) is not a second writer. Failing init here would
    // trade "no concurrency protection" for "the agent does not start".
    const store = storeWith({
      acquire: () =>
        Promise.reject(Object.assign(new Error("EACCES: permission denied"), { name: "Error" })),
    });

    await expect(acquireLeaseIfPossible(store, "agent-1")).resolves.toBeUndefined();

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("EACCES: permission denied");
    expect(diagnostics[0]).toContain("proceeding without single-writer protection");
  });

  it("swallows a non-Error rejection without crashing the diagnostic", async () => {
    const store = storeWith({ acquire: () => Promise.reject("plain string failure") });

    await expect(acquireLeaseIfPossible(store, "agent-1")).resolves.toBeUndefined();

    expect(diagnostics[0]).toContain("plain string failure");
  });
});

describe("releaseLeaseIfPossible", () => {
  it("releases the lease for the agent id when the store can release one", async () => {
    const released: string[] = [];
    const store = storeWith({
      release: (id: string) => {
        released.push(id);
        return Promise.resolve();
      },
    });

    await releaseLeaseIfPossible(store, "agent-1");

    expect(released).toEqual(["agent-1"]);
  });

  it("is a no-op for a store that declares no release", async () => {
    await expect(releaseLeaseIfPossible(storeWith(), "agent-1")).resolves.toBeUndefined();
  });

  it("propagates a release failure rather than hiding it", async () => {
    const boom = new Error("release failed");
    const store = storeWith({ release: () => Promise.reject(boom) });

    await expect(releaseLeaseIfPossible(store, "agent-1")).rejects.toBe(boom);
  });
});

describe("disposeLocalAgentSession", () => {
  function target(store: SessionStore): LocalAgentDisposeTarget {
    return {
      agentId: "agent-dispose",
      workspaceCwd: "/nonexistent-b002-dispose",
      lifecycleAbortController: new AbortController(),
      sessionStore: store,
    };
  }

  function recordingStore(): SessionStore {
    return {
      dispose: () => {
        hoisted.order.push("store.dispose");
        return Promise.resolve();
      },
    } as unknown as SessionStore;
  }

  it("flushes pending disk writes BEFORE the store releases the lease", async () => {
    await disposeLocalAgentSession(target(recordingStore()));

    expect(hoisted.order.indexOf("flushSessionWrites")).toBeLessThan(
      hoisted.order.indexOf("store.dispose"),
    );
    expect(hoisted.order.indexOf("flushRegistrySaves:/nonexistent-b002-dispose")).toBeLessThan(
      hoisted.order.indexOf("store.dispose"),
    );
  });

  it("releases the pooled MCP clients before flushing, and discards the session last", async () => {
    await disposeLocalAgentSession(target(recordingStore()));

    expect(hoisted.order).toEqual([
      "disposeSessionMcpClients:agent-dispose",
      "flushSessionWrites",
      "flushRegistrySaves:/nonexistent-b002-dispose",
      "store.dispose",
      "discardSession:/nonexistent-b002-dispose:agent-dispose",
    ]);
  });

  it("fires the lifecycle abort so an in-flight fetch cancels", async () => {
    const controller = new AbortController();

    await disposeLocalAgentSession({
      ...target(recordingStore()),
      lifecycleAbortController: controller,
    });

    expect(controller.signal.aborted).toBe(true);
  });

  it("completes for a store with no dispose method (the two-method port)", async () => {
    await expect(
      disposeLocalAgentSession(target({} as unknown as SessionStore)),
    ).resolves.toBeUndefined();

    expect(hoisted.order).toContain("discardSession:/nonexistent-b002-dispose:agent-dispose");
  });
});

describe("reloadLocalAgent", () => {
  const inline: Record<string, AgentDefinition> = {
    reviewer: { prompt: "review it" } as AgentDefinition,
  };

  function reloadTarget(over: Partial<LocalAgentReloadTarget> = {}): LocalAgentReloadTarget {
    const options: AgentOptions = { agents: inline };
    return {
      workspaceCwd: "/nonexistent-b002-reload",
      settingSourcesIncludeProject: false,
      options,
      skillsManager: undefined,
      pluginsManager: undefined,
      ...over,
    };
  }

  it("re-reads every file-discovered source that is present", async () => {
    const refreshed: string[] = [];
    const agent = reloadTarget({
      context: {
        refresh: () => {
          refreshed.push("context");
          return Promise.resolve();
        },
      } as unknown as LocalAgentReloadTarget["context"],
      skillsManager: {
        refresh: () => {
          refreshed.push("skills");
          return Promise.resolve();
        },
      } as unknown as LocalAgentReloadTarget["skillsManager"],
      pluginsManager: {
        refresh: () => {
          refreshed.push("plugins");
          return Promise.resolve();
        },
      } as unknown as LocalAgentReloadTarget["pluginsManager"],
    });

    await reloadLocalAgent(agent);

    expect(refreshed).toEqual(["context", "skills", "plugins"]);
  });

  it("returns the freshly resolved subagents so the caller can assign them", async () => {
    const result = await reloadLocalAgent(reloadTarget());

    expect(Object.keys(result)).toEqual(["reviewer"]);
  });

  it("skips the managers the agent does not have without throwing", async () => {
    await expect(reloadLocalAgent(reloadTarget())).resolves.toEqual({
      reviewer: inline.reviewer,
    });
  });
});
