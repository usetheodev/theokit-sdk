import { describe, expect, it, vi } from "vitest";

import { Agent, type AgentOptions, AgentRunError } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { Run, RunResult } from "../src/types/run.js";

/**
 * T1.2 — `Agent.prompt` honors `AgentOptions.throwOnError`.
 *
 * The option is opt-in (default `false`, non-breaking). When `true`:
 *   - On `result.status === 'error'`, the promise rejects with `AgentRunError`.
 *   - On `result.status === 'cancelled'`, the promise resolves (cancel ≠ error; EC-2).
 *   - On malformed RunResult (`error: undefined`), the promise resolves (defensive guard; EC-3).
 *   - `agent.dispose()` always runs (try/finally preserved).
 *
 * Strategy: mock the SDK internals minimally — stub `Agent.create` to return
 * a fake `SDKAgent` whose `send()` returns a fake `Run` whose `wait()` returns
 * the canned `RunResult`. Tests the surface contract without spinning a real
 * provider.
 */

function makeFakeAgent(canned: Partial<RunResult>): {
  agent: SDKAgent;
  disposeSpy: ReturnType<typeof vi.fn>;
} {
  const disposeSpy = vi.fn().mockResolvedValue(undefined);
  const result: RunResult = {
    id: "run_fake",
    status: canned.status ?? "finished",
    result: canned.result,
    ...(canned.error !== undefined ? { error: canned.error } : {}),
  } as RunResult;
  const fakeRun: Partial<Run> = {
    wait: async () => result,
  };
  const fakeAgent: Partial<SDKAgent> = {
    send: async () => fakeRun as Run,
    dispose: disposeSpy,
  };
  return { agent: fakeAgent as SDKAgent, disposeSpy };
}

function stubAgentCreate(fakeAgent: SDKAgent): () => void {
  const original = Agent.create;
  (Agent as { create: typeof Agent.create }).create = async (_opts: AgentOptions) => fakeAgent;
  return () => {
    (Agent as { create: typeof Agent.create }).create = original;
  };
}

const OPTS: AgentOptions = {
  apiKey: "sk-test",
  model: { id: "claude-test" },
};

describe("Agent.prompt — throwOnError: true", () => {
  it("rejects with AgentRunError when status === 'error'", async () => {
    const { agent } = makeFakeAgent({
      status: "error",
      error: {
        message: "Anthropic API error: auth_failed (HTTP 401)",
        code: "auth_failed",
      },
    });
    const restore = stubAgentCreate(agent);
    try {
      await expect(Agent.prompt("hi", { ...OPTS, throwOnError: true })).rejects.toThrow(
        AgentRunError,
      );
    } finally {
      restore();
    }
  });

  it("AgentRunError carries .code from RunResult.error.code", async () => {
    const { agent } = makeFakeAgent({
      status: "error",
      error: { message: "rate", code: "rate_limit" },
    });
    const restore = stubAgentCreate(agent);
    try {
      try {
        await Agent.prompt("hi", { ...OPTS, throwOnError: true });
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AgentRunError);
        expect((e as AgentRunError).code).toBe("rate_limit");
      }
    } finally {
      restore();
    }
  });

  it("still returns result on success (status === 'finished')", async () => {
    const { agent } = makeFakeAgent({ status: "finished", result: "ok" });
    const restore = stubAgentCreate(agent);
    try {
      const r = await Agent.prompt("hi", { ...OPTS, throwOnError: true });
      expect(r.status).toBe("finished");
      expect(r.result).toBe("ok");
    } finally {
      restore();
    }
  });

  it("EC-2: does NOT throw on cancelled status", async () => {
    const { agent } = makeFakeAgent({ status: "cancelled" });
    const restore = stubAgentCreate(agent);
    try {
      const r = await Agent.prompt("hi", { ...OPTS, throwOnError: true });
      expect(r.status).toBe("cancelled");
    } finally {
      restore();
    }
  });

  it("EC-3: defensive guard — skipped when result.error === undefined despite status='error'", async () => {
    const { agent } = makeFakeAgent({ status: "error" }); // no error field
    const restore = stubAgentCreate(agent);
    try {
      const r = await Agent.prompt("hi", { ...OPTS, throwOnError: true });
      expect(r.status).toBe("error");
    } finally {
      restore();
    }
  });

  it("agent.dispose() runs even when throwOnError throws", async () => {
    const { agent, disposeSpy } = makeFakeAgent({
      status: "error",
      error: { message: "boom", code: "server_error" },
    });
    const restore = stubAgentCreate(agent);
    try {
      try {
        await Agent.prompt("hi", { ...OPTS, throwOnError: true });
      } catch {
        /* expected */
      }
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});

describe("Agent.prompt — throwOnError: false / omitted (regression guard)", () => {
  it("throwOnError=false: returns { status: 'error' } (no throw)", async () => {
    const { agent } = makeFakeAgent({
      status: "error",
      error: { message: "auth", code: "auth_failed" },
    });
    const restore = stubAgentCreate(agent);
    try {
      const r = await Agent.prompt("hi", { ...OPTS, throwOnError: false });
      expect(r.status).toBe("error");
      expect(r.error?.message).toBe("auth");
    } finally {
      restore();
    }
  });

  it("throwOnError undefined: defaults to false (no throw)", async () => {
    const { agent } = makeFakeAgent({
      status: "error",
      error: { message: "auth", code: "auth_failed" },
    });
    const restore = stubAgentCreate(agent);
    try {
      const r = await Agent.prompt("hi", OPTS);
      expect(r.status).toBe("error");
    } finally {
      restore();
    }
  });
});
