/**
 * B-002 — `createRealCloudRun`: the PaaS SSE transport behind `CloudAgent.send`.
 *
 * The golden cloud suite already constructs this Run (47/65 lines), but every
 * failure path was `FNDA:0`: the missing-credentials guard, the non-2xx
 * `NetworkError`, the transport-throw catch, `cancel()` and `fail()` itself. A
 * cloud run that silently reports `finished` on a 500 is indistinguishable from
 * a working one until a consumer reads an empty result.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRealCloudRun } from "../../../src/internal/cloud-agent/real-cloud-run.js";
import type { CloudAgentPayload } from "../../../src/internal/cloud-agent/types.js";
import type { AgentOptions } from "../../../src/types/agent.js";
import type { RunStatus } from "../../../src/types/run.js";

const BASE = "https://cloud.example.invalid";
const MODEL = { id: "anthropic/claude-opus-4" };

interface Captured {
  url: string;
  init: RequestInit;
}

/** A `fetch` impl that records the call and answers with a canned SSE body. */
function sseFetch(sse: string, captured: Captured[], status = 200): typeof fetch {
  return ((url: string, init: RequestInit) => {
    captured.push({ url, init });
    return Promise.resolve(
      new Response(status === 200 ? sse : sse, {
        status,
        headers: { "content-type": "text/event-stream" },
      }),
    );
  }) as unknown as typeof fetch;
}

function makeRun(
  over: {
    fetch?: typeof fetch;
    apiKey?: string;
    systemPrompt?: string;
    agentConfig?: CloudAgentPayload;
  } = {},
) {
  const agentOptions: AgentOptions = {
    ...(over.apiKey !== undefined ? { apiKey: over.apiKey } : {}),
  };
  return createRealCloudRun({
    agentId: "agent-cloud",
    model: MODEL,
    message: "hello cloud",
    agentOptions,
    sendOptions: {},
    ...(over.fetch !== undefined ? { fetch: over.fetch } : {}),
    ...(over.systemPrompt !== undefined ? { systemPrompt: over.systemPrompt } : {}),
    ...(over.agentConfig !== undefined ? { agentConfig: over.agentConfig } : {}),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createRealCloudRun — credentials guard", () => {
  it("fails the run with the actionable message when the API key is absent", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    vi.stubEnv("THEOKIT_API_KEY", "");
    const captured: Captured[] = [];

    const run = makeRun({ fetch: sseFetch("", captured) });
    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message).toBe(
      "Real cloud Run requires THEOKIT_API_KEY + THEOKIT_API_BASE_URL",
    );
    expect(captured).toHaveLength(0);
  });

  it("fails the run when the base URL is absent", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", "");
    const captured: Captured[] = [];

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch("", captured) });
    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(captured).toHaveLength(0);
  });

  it("posts the run when BOTH credentials are present", async () => {
    // rules/testing.md § 4.2 — without an accepted input the guard could reject
    // every cloud send and every assertion above would still pass.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    const run = makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch('event: result\ndata: {"result":"done","status":"finished"}\n\n', captured),
    });
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(captured).toHaveLength(1);
  });
});

describe("createRealCloudRun — request shape", () => {
  it("posts to /v1/agents/{agentId}/runs with the bearer token and SSE accept header", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    await makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch('event: result\ndata: {"result":"ok"}\n\n', captured),
    }).wait();

    expect(captured[0]?.url).toBe(`${BASE}/v1/agents/agent-cloud/runs`);
    expect(captured[0]?.init.method).toBe("POST");
    expect(captured[0]?.init.headers).toMatchObject({
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: "Bearer theo_live_key",
    });
  });

  it("carries the user text and omits systemPrompt/agentConfig when they were not supplied", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    await makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch('event: result\ndata: {"result":"ok"}\n\n', captured),
    }).wait();

    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
    expect(body.message).toBe("hello cloud");
    expect("systemPrompt" in body).toBe(false);
    expect("agentConfig" in body).toBe(false);
  });

  it("embeds the resolved system prompt and the agent config when they ARE supplied", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const agentConfig = { name: "cloud-agent" } as unknown as CloudAgentPayload;

    await makeRun({
      apiKey: "theo_live_key",
      systemPrompt: "you are terse",
      agentConfig,
      fetch: sseFetch('event: result\ndata: {"result":"ok"}\n\n', captured),
    }).wait();

    const body = JSON.parse(String(captured[0]?.init.body)) as Record<string, unknown>;
    expect(body.systemPrompt).toBe("you are terse");
    expect(body.agentConfig).toEqual({ name: "cloud-agent" });
  });
});

describe("createRealCloudRun — transport failures", () => {
  it("reports a non-2xx as an errored run carrying the status and the response body", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    const run = makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch("agent quota exhausted", captured, 503),
    });
    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message).toBe("Cloud Run endpoint returned 503: agent quota exhausted");
  });

  it("truncates a very long error body to 200 characters", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    const run = makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch("x".repeat(500), captured, 500),
    });
    const result = await run.wait();

    expect(result.error?.message).toBe(`Cloud Run endpoint returned 500: ${"x".repeat(200)}`);
  });

  it("reports a thrown transport error as an errored run instead of an unhandled rejection", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const failing = (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;

    const run = makeRun({ apiKey: "theo_live_key", fetch: failing });
    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message).toBe("ECONNREFUSED");
  });

  it("stringifies a non-Error rejection rather than losing it", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const failing = (() => Promise.reject("socket hang up")) as unknown as typeof fetch;

    const run = makeRun({ apiKey: "theo_live_key", fetch: failing });
    const result = await run.wait();

    expect(result.error?.message).toBe("socket hang up");
  });
});

describe("createRealCloudRun — secondary failures on the error path", () => {
  it("reports the status alone when the error body itself cannot be read", async () => {
    // `response.text()` can reject (a truncated or already-consumed body). The
    // status is the part that is always available, and losing it to a secondary
    // failure would replace a diagnosable "503" with an unhandled rejection.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const unreadable = (() =>
      Promise.resolve({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error("body already consumed")),
      })) as unknown as typeof fetch;

    const run = makeRun({ apiKey: "theo_live_key", fetch: unreadable });
    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message).toBe("Cloud Run endpoint returned 502: ");
  });

  it("stays CANCELLED when the aborted request rejects after the caller cancelled", async () => {
    // `cancel()` aborts the fetch, so the in-flight request rejects moments later.
    // Without the terminated check that rejection would re-terminate the run as an
    // ERROR, turning a deliberate cancel into a reported failure.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    let rejectFetch: (err: Error) => void = () => undefined;
    let resolveEntered: () => void = () => undefined;
    const entered = new Promise<void>((r) => {
      resolveEntered = r;
    });
    const aborting = (() => {
      resolveEntered();
      return new Promise<Response>((_res, rej) => {
        rejectFetch = rej;
      });
    }) as unknown as typeof fetch;

    const run = makeRun({ apiKey: "theo_live_key", fetch: aborting });
    await entered;
    await run.cancel();
    rejectFetch(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    // A turn boundary, not a delay: `setImmediate` runs after the whole microtask
    // queue, so the transport's catch has definitely executed by here.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const result = await run.wait();
    const messages: string[] = [];
    for await (const msg of run.stream()) messages.push(msg.type);

    expect(result.status).toBe("cancelled");
    expect(result.error).toBeUndefined();
    // Without the terminated check the aborted request would `fail()` the run,
    // pushing the abort text as an assistant reply the model never produced.
    expect(messages).toEqual([]);
  });
});

describe("createRealCloudRun — SSE translation", () => {
  it("surfaces the result event's text as the run result", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: status\ndata: {"status":"RUNNING"}\n\n',
      'event: assistant\ndata: {"text":"partial"}\n\n',
      'event: result\ndata: {"result":"final answer","status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(result.result).toBe("final answer");
  });

  it("honours a terminal status the server declares on the result event", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = 'event: result\ndata: {"result":"boom","status":"error"}\n\n';

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const result = await run.wait();

    expect(result.status).toBe("error");
  });

  it("defaults to finished when the result event declares no status", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];

    const run = makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch('event: result\ndata: {"result":"ok"}\n\n', captured),
    });

    expect((await run.wait()).status).toBe("finished");
  });

  it("falls back to the last assistant text when the result event carries none", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: assistant\ndata: {"text":"streamed answer"}\n\n',
      'event: result\ndata: {"status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });

    expect((await run.wait()).result).toBe("streamed answer");
  });

  it("keeps the assistant text when the result event's result is not a string", async () => {
    // The server field is external input. Unchecked, a non-string `result` becomes
    // the run's answer — a consumer reading `result.result` gets a number where the
    // contract promises text, and the real answer that DID stream is discarded.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: assistant\ndata: {"text":"streamed answer"}\n\n',
      'event: result\ndata: {"result":42,"status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const result = await run.wait();

    expect(result.result).toBe("streamed answer");
  });

  it("leaves the result ABSENT — not empty-string — when the stream carried no text", async () => {
    // `undefined` and `""` are different answers to "did the model say anything?".
    // Assigning the empty string turns "no reply" into "an empty reply", which reads
    // as a successful silent run to any consumer branching on `result === undefined`.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: status\ndata: {"status":"running"}\n\n',
      'event: result\ndata: {"status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(result.result).toBeUndefined();
    expect(run.result).toBeUndefined();
  });

  it("streams the status and assistant events to the caller", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: status\ndata: {"status":"running"}\n\n',
      'event: assistant\ndata: {"text":"hi there"}\n\n',
      'event: result\ndata: {"result":"hi there","status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const seen: string[] = [];
    for await (const msg of run.stream()) seen.push(msg.type);

    expect(seen).toEqual(["status", "assistant"]);
  });

  it("skips a record whose data is not JSON instead of failing the whole run", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      "event: status\ndata: not-json\n\n",
      'event: result\ndata: {"result":"survived","status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(result.result).toBe("survived");
  });

  it("treats a non-string assistant text as empty rather than emitting the raw value", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: assistant\ndata: {"text":42}\n\n',
      'event: result\ndata: {"status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const seen: string[] = [];
    for await (const msg of run.stream()) {
      if (msg.type === "assistant") seen.push(JSON.stringify(msg.message.content));
    }

    expect(seen).toEqual([JSON.stringify([{ type: "text", text: "" }])]);
  });

  it("ignores an event name the Phase-1 contract does not define", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const sse = [
      'event: heartbeat\ndata: {"ping":1}\n\n',
      'event: result\ndata: {"result":"ok","status":"finished"}\n\n',
    ].join("");

    const run = makeRun({ apiKey: "theo_live_key", fetch: sseFetch(sse, captured) });
    const seen: string[] = [];
    for await (const msg of run.stream()) seen.push(msg.type);

    expect(seen).toEqual([]);
    expect((await run.wait()).status).toBe("finished");
  });
});

describe("createRealCloudRun — cancellation and status notification", () => {
  it("aborts the in-flight request signal when the caller cancels", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    let seenSignal: AbortSignal | undefined;
    let resolveEntered: () => void;
    const entered = new Promise<void>((r) => {
      resolveEntered = r;
    });
    const hanging = ((_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined;
      resolveEntered();
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;

    const run = makeRun({ apiKey: "theo_live_key", fetch: hanging });
    await entered;
    await run.cancel();

    expect(seenSignal?.aborted).toBe(true);
    expect((await run.wait()).status).toBe("cancelled");
  });

  it("fires onDidChangeStatus immediately with the current status on subscribe", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const captured: Captured[] = [];
    const seen: RunStatus[] = [];

    const run = makeRun({
      apiKey: "theo_live_key",
      fetch: sseFetch('event: result\ndata: {"result":"ok","status":"finished"}\n\n', captured),
    });
    run.onDidChangeStatus((s) => seen.push(s));

    expect(seen).toEqual(["running"]);
    await run.wait();
    expect(seen).toEqual(["running", "finished"]);
  });
});

describe("createRealCloudRun — server status normalisation (#341)", () => {
  /** Drives a full stream and returns both the live run status and the settled result. */
  async function statusesFor(sse: string): Promise<{ run: RunStatus; result: RunStatus }> {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const run = makeRun({ apiKey: "k", fetch: sseFetch(sse, []) });
    const result = await run.wait();
    return { run: run.status, result: result.status };
  }

  it("maps the documented UPPERCASE terminal token onto RunStatus", async () => {
    // Arrange — this module's own contract comment says the server sends
    // "CREATING|RUNNING|FINISHED|ERROR". `RunStatus` is lowercase.
    const sse = 'event: result\ndata: {"result":"x","status":"FINISHED"}\n\n';

    // Act
    const { run, result } = await statusesFor(sse);

    // Assert — a consumer writing `if (result.status === "finished")` must see it fire.
    expect(result).toBe("finished");
    expect(run).toBe("finished");
  });

  it("maps UPPERCASE ERROR so throwOnError and error branches can fire", async () => {
    const sse = 'event: result\ndata: {"result":"","status":"ERROR"}\n\n';
    const { run, result } = await statusesFor(sse);
    expect(result).toBe("error");
    expect(run).toBe("error");
  });

  it("maps CANCELLED and treats EXPIRED as an error", async () => {
    const cancelled = await statusesFor('event: result\ndata: {"status":"CANCELLED"}\n\n');
    expect(cancelled.result).toBe("cancelled");
    // EXPIRED is a member of the wire-level status union but has no RunStatus of its own.
    // A run that expired did not finish, so it settles as an error rather than silently
    // reading as success.
    const expired = await statusesFor('event: result\ndata: {"status":"EXPIRED"}\n\n');
    expect(expired.result).toBe("error");
  });

  it("still accepts the lowercase token, which is what the server actually sent before", async () => {
    // The accepted case in the other direction: normalisation must not break the shape the
    // existing suite already pinned.
    const { result } = await statusesFor(
      'event: result\ndata: {"result":"x","status":"finished"}\n\n',
    );
    expect(result).toBe("finished");
  });

  it("fails the run with an actionable message when the token is not a status at all", async () => {
    // Fail-fast at the boundary (rules/error-handling.md § 2): an unrecognised token is not
    // silently coerced to "finished", which would report a run of unknown outcome as success.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const sse = 'event: result\ndata: {"result":"x","status":"IMPOSSIBLE"}\n\n';
    const run = makeRun({ apiKey: "k", fetch: sseFetch(sse, []) });

    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message ?? "").toContain("IMPOSSIBLE");
  });

  it("leaves the wire-level status EVENT uppercase, which is its declared union", async () => {
    // SDKStatusMessage.status is "CREATING"|"RUNNING"|"FINISHED"|... by contract. Normalising
    // that too would be a different bug; this pins the boundary between the two.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const sse =
      'event: status\ndata: {"status":"RUNNING"}\n\nevent: result\ndata: {"result":"x","status":"FINISHED"}\n\n';
    const run = makeRun({ apiKey: "k", fetch: sseFetch(sse, []) });
    const seen: string[] = [];
    for await (const message of run.stream()) {
      if (message.type === "status") seen.push(message.status);
    }
    expect(seen).toContain("RUNNING");
  });
});

describe("createRealCloudRun — the wire-level status event is validated too (#341)", () => {
  it("normalises the event token's case without leaving the uppercase union", async () => {
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const sse =
      'event: status\ndata: {"status":"running"}\n\nevent: result\ndata: {"result":"x","status":"FINISHED"}\n\n';
    const run = makeRun({ apiKey: "k", fetch: sseFetch(sse, []) });
    const seen: string[] = [];
    for await (const message of run.stream()) {
      if (message.type === "status") seen.push(message.status);
    }
    // A lowercase token from the server still lands in the union the SDK publishes.
    expect(seen).toContain("RUNNING");
  });

  it("fails the run when the status EVENT carries a token outside the union", async () => {
    // The other cast the issue named. Left alone, `status as SDKStatusMessage["status"]` put an
    // arbitrary server string into a closed union that consumers switch on.
    vi.stubEnv("THEOKIT_API_BASE_URL", BASE);
    const sse = 'event: status\ndata: {"status":"WAT"}\n\n';
    const run = makeRun({ apiKey: "k", fetch: sseFetch(sse, []) });

    const result = await run.wait();

    expect(result.status).toBe("error");
    expect(result.error?.message ?? "").toContain("WAT");
  });
});
