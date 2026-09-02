/**
 * B-002 — `executeSendLocked`, the local send critical section.
 *
 * The backlog premise ("no test enters this module") is false as measured: the
 * golden agent suite alone drives `executeSendLocked` FNDA:64 and 36/45 lines.
 * What no test does is CONSTRAIN it — every ordering decision, every guard and
 * every short-circuit below survives being deleted. Each `it` here is written
 * against one specific mutant of this file, named for the behaviour it pins.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentDisposedError } from "../../../src/errors.js";
import type { MemoryToolSpec } from "../../../src/internal/agent-loop/types.js";
import { setDiagnosticsSink } from "../../../src/internal/diagnostics.js";
import type { SendLockedInputs } from "../../../src/internal/local-agent/local-agent-send.js";
import { executeSendLocked } from "../../../src/internal/local-agent/local-agent-send.js";
import { withCwdMutex } from "../../../src/internal/persistence/cwd-mutex.js";
import { PluginManager } from "../../../src/internal/plugins/manager.js";
import { Plugin } from "../../../src/internal/plugins/types.js";
import type { MemoryProvider } from "../../../src/internal/runtime/memory-glue/memory-provider.js";
import { createNoopMemoryProvider } from "../../../src/internal/runtime/memory-glue/memory-provider-noop.js";
import type { MemoryFact } from "../../../src/internal/runtime/memory-glue/memory-store.js";
import { appendSessionMessage, getSessionMessages } from "../../../src/internal/session/index.js";
import { createTelemetry } from "../../../src/internal/telemetry/tracer.js";
import type { AgentOptions, ModelSelection } from "../../../src/types/agent.js";
import type { SDKMessage } from "../../../src/types/messages.js";
import type { PostAssistantReplyContext } from "../../../src/types/plugin.js";
import type { Processor } from "../../../src/types/processors.js";
import type {
  Run,
  RunOperation,
  RunResult,
  RunTimelineEvent,
  SDKUserMessage,
  SendOptions,
} from "../../../src/types/run.js";
import type { RunEvent } from "../../../src/types/run-events.js";

/** A terminal, already-finished Run — the object `dispatchRun` hands back. */
function makeStubRun(id: string, text: string): Run {
  const result: RunResult = { id, status: "finished", result: text };
  const empty = <T>(): AsyncGenerator<T, void> =>
    ({
      next: () => Promise.resolve({ done: true, value: undefined }),
      return: () => Promise.resolve({ done: true, value: undefined }),
      throw: (err: unknown) => Promise.reject(err),
      [Symbol.asyncIterator]() {
        return this;
      },
    }) as unknown as AsyncGenerator<T, void>;
  return {
    id,
    agentId: "stub",
    status: "finished",
    result: text,
    stream: () => empty<SDKMessage>(),
    events: () => empty<RunTimelineEvent>(),
    wait: () => Promise.resolve(result),
    cancel: () => Promise.resolve(),
    conversation: () => Promise.resolve([]),
    supports: (_op: RunOperation) => true,
    unsupportedReason: (_op: RunOperation) => undefined,
    onDidChangeStatus: () => () => undefined,
  };
}

/** Everything the send handed to its collaborators, in call order. */
interface Recorder {
  order: string[];
  models: Array<ModelSelection | undefined>;
  preHookTexts: string[];
  beforeSend: Array<{ conversationId: string; previousMessageCount: number }>;
  dispatch: Array<{
    message: string | SDKUserMessage;
    options: SendOptions;
    systemPrompt: string | undefined;
    memoryFacts: ReadonlyArray<MemoryFact>;
    priorMessages: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
    memoryTools: ReadonlyArray<MemoryToolSpec> | undefined;
    memoryProvider: MemoryProvider | undefined;
  }>;
  assembled: Array<{ base: string | undefined; userText: string }>;
  reloads: number;
  cleared: number;
}

let seq = 0;
const usedAgentIds: string[] = [];
/** Every send touches the workspace (memory glue mkdir); keep it off the real tree. */
let workspace = "";

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "b002-send-ws-"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function build(overrides: Partial<SendLockedInputs> = {}): {
  inputs: SendLockedInputs;
  rec: Recorder;
  agentId: string;
} {
  seq += 1;
  const agentId = `b002-send-${seq}-${Math.random().toString(36).slice(2, 8)}`;
  usedAgentIds.push(agentId);
  const rec: Recorder = {
    order: [],
    models: [],
    preHookTexts: [],
    beforeSend: [],
    dispatch: [],
    assembled: [],
    reloads: 0,
    cleared: 0,
  };
  const agentOptions: AgentOptions = { name: agentId };
  const inputs: SendLockedInputs = {
    agentId,
    disposed: false,
    invalidationPending: undefined,
    clearInvalidation: () => {
      rec.cleared += 1;
      rec.order.push("clearInvalidation");
    },
    reload: () => {
      rec.reloads += 1;
      rec.order.push("reload");
      return Promise.resolve();
    },
    applyModelOverride: (model) => {
      rec.models.push(model);
      rec.order.push("applyModelOverride");
    },
    options: agentOptions,
    pluginManagerCode: new PluginManager(),
    defaultMemoryProviderForLoop: createNoopMemoryProvider(),
    workspaceCwd: workspace,
    telemetry: createTelemetry(undefined),
    lifecycleAbortController: new AbortController(),
    runPreHook: (userText) => {
      rec.preHookTexts.push(userText);
      rec.order.push("runPreHook");
      return Promise.resolve();
    },
    resolveSystemPromptForSend: () => Promise.resolve("BASE"),
    assembleSystemPromptForSend: ({ userText, baseSystemPrompt }) => {
      rec.assembled.push({ base: baseSystemPrompt, userText });
      return Promise.resolve(`ASSEMBLED:${baseSystemPrompt ?? ""}`);
    },
    dispatchRun: (args) => {
      rec.order.push("dispatchRun");
      rec.dispatch.push({ ...args, memoryProvider: args.memoryProviderOverride });
      return Promise.resolve(makeStubRun(`run-${agentId}`, "MODEL TEXT"));
    },
    ...overrides,
  };
  return { inputs, rec, agentId };
}

/** A processor that aborts on every input. */
function blockingProcessor(id: string, reason: string): Processor {
  return {
    id,
    processInput: (ctx) => ctx.abort(reason),
  };
}

/** A processor that rewrites the input to a fixed string. */
function rewritingProcessor(id: string, replacement: string): Processor {
  return { id, processInput: () => replacement };
}

afterEach(() => {
  // `sessions` is a module-level Map keyed by agentId; each test mints a unique
  // id, so nothing to erase — this only guards against an id being reused.
  usedAgentIds.length = 0;
});

describe("executeSendLocked — disposal guard", () => {
  it("throws AgentDisposedError naming the agent when the agent is disposed", async () => {
    const { inputs, rec, agentId } = build({ disposed: true });

    await expect(executeSendLocked(inputs, "hello", {})).rejects.toBeInstanceOf(AgentDisposedError);
    await expect(executeSendLocked(inputs, "hello", {})).rejects.toThrow(agentId);
    expect(rec.dispatch).toHaveLength(0);
  });

  it("dispatches the send when the agent is NOT disposed", async () => {
    // rules/testing.md § 4.2 — the guard needs an input it ACCEPTS, otherwise
    // `if (true)` (reject every send) is indistinguishable from the real check.
    const { inputs, rec } = build({ disposed: false });

    const run = await executeSendLocked(inputs, "hello", {});

    expect(run.status).toBe("finished");
    expect(rec.dispatch).toHaveLength(1);
  });
});

describe("executeSendLocked — pending invalidation", () => {
  it("reloads and clears the invalidation before dispatching", async () => {
    const { inputs, rec } = build({
      invalidationPending: { reason: "settings changed", at: 1 },
    });

    await executeSendLocked(inputs, "hello", {});

    expect(rec.reloads).toBe(1);
    expect(rec.cleared).toBe(1);
    expect(rec.order.indexOf("reload")).toBeLessThan(rec.order.indexOf("dispatchRun"));
  });

  it("does not reload when no invalidation is pending", async () => {
    const { inputs, rec } = build({ invalidationPending: undefined });

    await executeSendLocked(inputs, "hello", {});

    expect(rec.reloads).toBe(0);
    expect(rec.dispatch).toHaveLength(1);
  });
});

describe("executeSendLocked — model override", () => {
  it("normalizes a bare-string send model to a ModelSelection before applying it", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", { model: "anthropic/claude-opus-4" });

    expect(rec.models).toEqual([{ id: "anthropic/claude-opus-4" }]);
  });

  it("applies undefined when the send carries no model override", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});

    expect(rec.models).toEqual([undefined]);
  });
});

describe("executeSendLocked — input guardrail processors", () => {
  it("returns a cancelled tripwire run and never dispatches when a processor aborts", async () => {
    const { inputs, rec, agentId } = build();
    inputs.options.inputProcessors = [blockingProcessor("pii-block", "contains an SSN")];

    const run = await executeSendLocked(inputs, "my ssn is 1", {});
    const result = await run.wait();

    expect(run.status).toBe("cancelled");
    expect(result.tripwire).toEqual({ reason: "contains an SSN", processorId: "pii-block" });
    expect(rec.dispatch).toHaveLength(0);
    // The block happens BEFORE any side effect: nothing was written to the session.
    expect(getSessionMessages(agentId)).toHaveLength(0);
    expect(rec.preHookTexts).toHaveLength(0);
  });

  it("emits the tripwire run-event carrying the reason and the processor id", async () => {
    const { inputs } = build();
    inputs.options.inputProcessors = [blockingProcessor("pii-block", "contains an SSN")];
    const events: RunEvent[] = [];

    await executeSendLocked(inputs, "my ssn is 1", { onRunEvent: (e) => events.push(e) });

    expect(events).toEqual([
      { type: "tripwire", reason: "contains an SSN", processorId: "pii-block" },
    ]);
  });

  it("carries the send model onto the tripwire run so a blocked send is still attributable", async () => {
    const { inputs } = build();
    inputs.options.inputProcessors = [blockingProcessor("pii-block", "nope")];

    const run = await executeSendLocked(inputs, "secret", { model: "anthropic/claude-opus-4" });

    expect(run.model).toEqual({ id: "anthropic/claude-opus-4" });
  });

  it("feeds the REWRITTEN text downstream when a processor rewrites the input", async () => {
    const { inputs, rec, agentId } = build();
    inputs.options.inputProcessors = [rewritingProcessor("redact", "REDACTED")];

    await executeSendLocked(inputs, "my card is 4111", {});

    expect(rec.dispatch[0]?.message).toBe("REDACTED");
    expect(rec.preHookTexts).toEqual(["REDACTED"]);
    expect(getSessionMessages(agentId)).toEqual([{ role: "user", text: "REDACTED" }]);
  });

  it("preserves the SDKUserMessage envelope while replacing only its text on a rewrite", async () => {
    const { inputs, rec } = build();
    inputs.options.inputProcessors = [rewritingProcessor("redact", "REDACTED")];
    const message: SDKUserMessage = { text: "my card is 4111", images: [] };

    await executeSendLocked(inputs, message, {});

    expect(rec.dispatch[0]?.message).toEqual({ text: "REDACTED", images: [] });
  });

  it("passes the message through untouched when no input processors are configured", async () => {
    // § 4.2 accepted case for the `processors === undefined || length === 0` short-circuit.
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "plain text", {});

    expect(rec.dispatch[0]?.message).toBe("plain text");
    expect(rec.preHookTexts).toEqual(["plain text"]);
  });

  it("passes the message through untouched when the processor list is empty", async () => {
    const { inputs, rec } = build();
    inputs.options.inputProcessors = [];

    await executeSendLocked(inputs, "plain text", {});

    expect(rec.dispatch[0]?.message).toBe("plain text");
  });
});

describe("executeSendLocked — session bookkeeping order", () => {
  it("reports the count BEFORE this message to onBeforeSend", async () => {
    const { inputs, rec, agentId } = build();
    appendSessionMessage(agentId, { role: "user", text: "earlier" });
    appendSessionMessage(agentId, { role: "assistant", text: "reply" });
    const seen: Array<{ conversationId: string; previousMessageCount: number }> = [];
    inputs.options.onBeforeSend = (ctx) => {
      seen.push(ctx);
      rec.order.push("onBeforeSend");
      return Promise.resolve();
    };

    await executeSendLocked(inputs, "now", {});

    expect(seen).toEqual([{ conversationId: agentId, previousMessageCount: 2 }]);
  });

  it("hands the dispatch the prior turns WITHOUT the message being sent", async () => {
    const { inputs, rec, agentId } = build();
    appendSessionMessage(agentId, { role: "user", text: "earlier" });

    await executeSendLocked(inputs, "now", {});

    expect(rec.dispatch[0]?.priorMessages).toEqual([{ role: "user", text: "earlier" }]);
    // …and the current message IS appended, so the next send sees it.
    expect(getSessionMessages(agentId)).toEqual([
      { role: "user", text: "earlier" },
      { role: "user", text: "now" },
    ]);
  });

  it("runs the pre-send hook before the dispatch", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "now", {});

    expect(rec.order.indexOf("runPreHook")).toBeLessThan(rec.order.indexOf("dispatchRun"));
  });
});

describe("executeSendLocked — system prompt assembly", () => {
  it("dispatches the ASSEMBLED prompt, not the resolved base prompt", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});

    expect(rec.assembled).toEqual([{ base: "BASE", userText: "hello" }]);
    expect(rec.dispatch[0]?.systemPrompt).toBe("ASSEMBLED:BASE");
  });
});

describe("executeSendLocked — abort signal composition", () => {
  it("aborts the dispatched signal when the agent lifecycle controller aborts", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});
    const composed = rec.dispatch[0]?.options.signal;

    expect(composed?.aborted).toBe(false);
    inputs.lifecycleAbortController.abort();
    expect(composed?.aborted).toBe(true);
  });

  it("aborts the dispatched signal when the CALLER's own signal aborts", async () => {
    const { inputs, rec } = build();
    const caller = new AbortController();

    await executeSendLocked(inputs, "hello", { signal: caller.signal });
    const composed = rec.dispatch[0]?.options.signal;

    expect(composed?.aborted).toBe(false);
    caller.abort();
    expect(composed?.aborted).toBe(true);
  });
});

describe("executeSendLocked — memory facts", () => {
  it("dispatches an empty fact list when memory is disabled", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});

    expect(rec.dispatch[0]?.memoryFacts).toEqual([]);
  });
});

describe("executeSendLocked — output processors", () => {
  it("returns the dispatched run unwrapped when no output processors are configured", async () => {
    const { inputs } = build();

    const run = await executeSendLocked(inputs, "hello", {});
    const result = await run.wait();

    expect(result.result).toBe("MODEL TEXT");
  });

  it("redacts the final reply through the output processors when they are configured", async () => {
    const { inputs } = build();
    inputs.options.outputProcessors = [
      { id: "shout", processOutput: (ctx) => ctx.text.toLowerCase() },
    ];

    const run = await executeSendLocked(inputs, "hello", {});
    const result = await run.wait();

    expect(result.result).toBe("model text");
  });
});

describe("executeSendLocked — memory read degradation", () => {
  it("hands the dispatch the facts written in the workspace MEMORY.md", async () => {
    // The whole point of `readMemoryForSend`. An earlier version of this test
    // asserted `toEqual([])` on a workspace with no facts — byte-identical to the
    // memory-DISABLED assertion, so replacing the entire function body with
    // `return []` passed it. Real facts on disk are what distinguishes reading
    // from not reading.
    const dir = await mkdtemp(join(tmpdir(), "b002-mem-"));
    try {
      await mkdir(join(dir, ".theokit", "memory"), { recursive: true });
      await writeFile(
        join(dir, ".theokit", "memory", "MEMORY.md"),
        "# Memory\n\n## Facts\n\n- the deploy target is staging\n- the operator prefers UTC\n",
      );
      const { inputs, rec } = build({ workspaceCwd: dir });
      inputs.options.memory = { enabled: true };

      await executeSendLocked(inputs, "hello", {});

      expect(rec.dispatch[0]?.memoryFacts).toEqual([
        { text: "the deploy target is staging" },
        { text: "the operator prefers UTC" },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does NOT read the workspace facts when memory is disabled", async () => {
    // Same workspace, same facts on disk — the only difference is the flag. This
    // is the pair that makes the assertion above mean something.
    const dir = await mkdtemp(join(tmpdir(), "b002-mem-"));
    try {
      await mkdir(join(dir, ".theokit", "memory"), { recursive: true });
      await writeFile(
        join(dir, ".theokit", "memory", "MEMORY.md"),
        "# Memory\n\n## Facts\n\n- the deploy target is staging\n",
      );
      const { inputs, rec } = build({ workspaceCwd: dir });

      await executeSendLocked(inputs, "hello", {});

      expect(rec.dispatch[0]?.memoryFacts).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("emits no diagnostic on the ordinary memory-disabled send", async () => {
    // Kills the "drop the enabled guard" mutant. Without the guard,
    // `readMemoryFacts(cwd, undefined)` dereferences `config.enabled` and throws;
    // `safeCall` absorbs it and the send still succeeds — so the only observable
    // difference is a "memory read failed: Cannot read properties of undefined"
    // line on the diagnostics channel of EVERY send with memory off.
    const messages: string[] = [];
    setDiagnosticsSink((m) => messages.push(m));
    try {
      const { inputs } = build();

      await executeSendLocked(inputs, "hello", {});

      expect(messages).toEqual([]);
    } finally {
      setDiagnosticsSink(undefined);
    }
  });

  it("still sends when the workspace memory directory is unusable", async () => {
    // A workspace path that is a FILE, not a directory. Named for what it
    // actually pins: the read path is fail-safe end to end. It does NOT reach
    // `safeCall` — every layer under `readMemoryFacts` already swallows an I/O
    // error and returns `[]` — which is why the test below exists separately.
    const dir = await mkdtemp(join(tmpdir(), "b002-mem-"));
    const asFile = join(dir, "not-a-dir");
    await writeFile(asFile, "x");
    try {
      const { inputs, rec } = build({ workspaceCwd: asFile });
      inputs.options.memory = { enabled: true };

      const run = await executeSendLocked(inputs, "hello", {});

      expect(run.status).toBe("finished");
      expect(rec.dispatch[0]?.memoryFacts).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("degrades to no facts — not a rejected send — when the memory config is invalid", async () => {
    // `sanitizeIdentifier` throws ConfigurationError for a traversal-shaped
    // namespace, so `readMemoryFacts` really does throw here. `safeCall` must
    // absorb it: a best-effort recall is not worth failing the user's send over.
    const dir = await mkdtemp(join(tmpdir(), "b002-mem-"));
    try {
      const { inputs, rec } = build({ workspaceCwd: dir });
      inputs.options.memory = { enabled: true, namespace: "../escape" };

      const run = await executeSendLocked(inputs, "hello", {});

      expect(run.status).toBe("finished");
      expect(rec.dispatch[0]?.memoryFacts).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("executeSendLocked — completion check wiring", () => {
  it("attaches the judge verdict to the result when a completionCheck is set", async () => {
    // With no resolvable judge key, `judgeCallImpl` short-circuits to its own
    // fail-safe verdict — no network, no auxiliary agent. What this pins is that
    // the judge dep is WIRED at all: drop the `deps` argument and `wait()` carries
    // no `completionCheck` field whatsoever.
    vi.stubEnv("OPENROUTER_API_KEY", undefined);
    const facadeKey = Symbol.for("theokit.internal.runtime.agentFacade");
    const host = globalThis as unknown as Record<symbol, unknown>;
    const previous = host[facadeKey];
    host[facadeKey] = {
      create: () => Promise.reject(new Error("the judge must not create an agent here")),
    };
    try {
      const { inputs } = build();

      const run = await executeSendLocked(inputs, "hello", {
        completionCheck: { criteria: "the answer names a file" },
      });
      const result = await run.wait();

      expect(result.completionCheck?.complete).toBe(false);
      expect(result.completionCheck?.parseFailed).toBe(true);
      expect(result.completionCheck?.reason).toContain("judge unavailable");
    } finally {
      if (previous === undefined) delete host[facadeKey];
      else host[facadeKey] = previous;
      vi.unstubAllEnvs();
    }
  });

  it("returns the run untouched when no completionCheck is set", async () => {
    const { inputs } = build();

    const result = await executeSendLocked(inputs, "hello", {}).then((r) => r.wait());

    expect(result.completionCheck).toBeUndefined();
  });
});

describe("executeSendLocked — the send critical section under the per-agent lock", () => {
  // `LocalAgent.send` runs this function inside `withCwdMutex('agent-send:<id>')`
  // (ADR D19 / EC-8). These drive it through the same wrapper, because the two
  // behaviours the item names — concurrent sends serialise, and the lock comes
  // back when the inner call throws — only exist at that composition.
  function sendUnderLock(
    inputs: SendLockedInputs,
    message: string,
    options: SendOptions = {},
  ): Promise<Run> {
    return withCwdMutex(`agent-send:${inputs.agentId}`, () =>
      executeSendLocked(inputs, message, options),
    );
  }

  it("serialises two concurrent sends to the same agent", async () => {
    const trace: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const { inputs } = build({
      dispatchRun: async () => {
        calls += 1;
        const tag = `dispatch-${calls}`;
        trace.push(`enter:${tag}`);
        if (calls === 1) await firstInFlight;
        trace.push(`exit:${tag}`);
        return makeStubRun(tag, "MODEL TEXT");
      },
    });

    const first = sendUnderLock(inputs, "one");
    const second = sendUnderLock(inputs, "two");
    releaseFirst();
    await Promise.all([first, second]);

    expect(trace).toEqual([
      "enter:dispatch-1",
      "exit:dispatch-1",
      "enter:dispatch-2",
      "exit:dispatch-2",
    ]);
  });

  it("propagates the inner failure to the caller rather than swallowing it", async () => {
    const boom = new AgentDisposedError("inner-agent");
    const { inputs } = build({ dispatchRun: () => Promise.reject(boom) });

    await expect(sendUnderLock(inputs, "one")).rejects.toBeInstanceOf(AgentDisposedError);
  });

  it("hands the lock back when the inner dispatch throws, so the next send proceeds", async () => {
    // The failure mode this guards: a critical section that keeps the mutex on
    // the error path deadlocks the agent — every later send on that id waits
    // forever, and nothing in a happy-path suite ever notices.
    let attempt = 0;
    const { inputs } = build({
      dispatchRun: () => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error("provider refused the run"));
        return Promise.resolve(makeStubRun("run-after-failure", "RECOVERED"));
      },
    });

    await expect(sendUnderLock(inputs, "one")).rejects.toThrow("provider refused the run");
    const recovered = await sendUnderLock(inputs, "two");

    expect(attempt).toBe(2);
    expect((await recovered.wait()).result).toBe("RECOVERED");
  });

  it("hands the lock back when the send throws BEFORE the dispatch", async () => {
    // The disposal guard throws on the very first line of the critical section —
    // before any `try`. A lock released only after a successful dispatch would
    // strand the agent here too.
    const { inputs } = build({ disposed: true });
    // A second, healthy handle on the SAME agent id — so it queues behind the
    // same mutex key the failed send took.
    const healthy = build({ agentId: inputs.agentId });

    await expect(sendUnderLock(inputs, "one")).rejects.toBeInstanceOf(AgentDisposedError);
    const run = await sendUnderLock(healthy.inputs, "two");

    expect(run.status).toBe("finished");
  });
});

describe("executeSendLocked — plugin memory hooks", () => {
  /** A `PluginManager` carrying one `post_assistant_reply` handler. */
  async function managerWithPostReply(
    onReply: (ctx: PostAssistantReplyContext) => void,
  ): Promise<PluginManager> {
    const manager = new PluginManager();
    await manager.initialize([
      Plugin.create({
        name: "b002-post-reply",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("post_assistant_reply", (hookCtx) => {
            onReply(hookCtx as PostAssistantReplyContext);
          });
        },
      }),
    ]);
    return manager;
  }

  it("fires post_assistant_reply once the caller awaits the run", async () => {
    const seen: PostAssistantReplyContext[] = [];
    let fired: () => void = () => undefined;
    const hookRan = new Promise<void>((resolve) => {
      fired = resolve;
    });
    const manager = await managerWithPostReply((ctx) => {
      seen.push(ctx);
      fired();
    });
    const { inputs, agentId } = build({ pluginManagerCode: manager });

    const run = await executeSendLocked(inputs, "what is the deploy target?", {});
    expect(seen).toHaveLength(0); // not before wait() — the reply does not exist yet

    await run.wait();
    await hookRan;

    expect(seen).toHaveLength(1);
    expect(seen[0]?.agentId).toBe(agentId);
    expect(seen[0]?.prompt).toBe("what is the deploy target?");
    expect(seen[0]?.reply).toBe("MODEL TEXT");
  });

  it("shows the hook the PROCESSED reply, because output processors wrap inside it", async () => {
    // The wrap order the source defends in a comment and nothing pinned: output
    // processors go INNER so `post_assistant_reply` observes the FINAL text. Swap
    // the two and memory records the raw model output the user never saw.
    const replies: string[] = [];
    let fired: () => void = () => undefined;
    const hookRan = new Promise<void>((resolve) => {
      fired = resolve;
    });
    const manager = await managerWithPostReply((ctx) => {
      replies.push(ctx.reply);
      fired();
    });
    const { inputs } = build({ pluginManagerCode: manager });
    inputs.options.outputProcessors = [
      { id: "redact", processOutput: () => "[REDACTED BY POLICY]" },
    ];

    const run = await executeSendLocked(inputs, "hello", {});
    const result = await run.wait();
    await hookRan;

    expect(result.result).toBe("[REDACTED BY POLICY]");
    expect(replies).toEqual(["[REDACTED BY POLICY]"]);
  });

  it("wraps the user message in the recalled memory context from pre_user_send", async () => {
    const manager = new PluginManager();
    await manager.initialize([
      Plugin.create({
        name: "b002-pre-send",
        version: "1.0.0",
        kind: "general",
        register: (ctx) => {
          ctx.on("pre_user_send", () => ({ recalledContext: "the target is staging" }));
        },
      }),
    ]);
    const { inputs, rec } = build({ pluginManagerCode: manager });

    await executeSendLocked(inputs, "where do I deploy?", {});

    expect(rec.dispatch[0]?.message).toBe(
      "<memory-context>\nthe target is staging\n</memory-context>\n\nwhere do I deploy?",
    );
    // The SESSION still records what the user actually typed, not the augmented prompt.
    expect(rec.preHookTexts).toEqual(["where do I deploy?"]);
  });
});

/**
 * Which memory implementation the loop talks to.
 *
 * These used to describe a fork — "legacy glue by default, port provider under
 * `THEOKIT_PORT_MEMORY_PATH=1`". The kernel flip (2026-09-02) removed the fork and the env var with
 * it, so what is left to protect is the PRECEDENCE, and it still matters for the same reason: both
 * arrangements return a working loop, so only the wrong provider distinguishes them — and that
 * surfaces far from here, as memory that silently stops recalling.
 *
 * The third case moved here from `agent-loop/memory-provider-reaches-the-loop.test.ts`, which
 * asserted it against `resolveMemoryProviderForLoop` — a function that no longer exists. Observing
 * what `dispatchRun` receives is the stronger oracle anyway: it reads production, not a helper.
 */
describe("executeSendLocked — which MemoryProvider reaches the loop", () => {
  it("uses the auto-installed adapter when the consumer supplied none", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});

    expect(rec.dispatch[0]?.memoryProvider).toBe(inputs.defaultMemoryProviderForLoop);
  });

  it("surfaces no memoryTools on the loop inputs — the provider builds them inside", async () => {
    const { inputs, rec } = build();

    await executeSendLocked(inputs, "hello", {});

    expect(rec.dispatch[0]?.memoryTools).toBeUndefined();
  });

  it("lets a consumer-supplied memoryProvider outrank the adapter", async () => {
    const supplied = createNoopMemoryProvider();
    const { inputs, rec } = build();
    inputs.options.memoryProvider = supplied;

    await executeSendLocked(inputs, "hello", {});

    expect(rec.dispatch[0]?.memoryProvider).toBe(supplied);
  });
});
