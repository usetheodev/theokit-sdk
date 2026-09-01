import { expect, it } from "vitest";
import type { LoopContext } from "../../../src/internal/agent-loop/loop-context-init.js";
import { streamLlmTurn } from "../../../src/internal/agent-loop/loop-llm-stream.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/types.js";
import type {
  LlmClient,
  LlmEvent,
  LlmFinish,
  LlmRequest,
} from "../../../src/internal/llm/types.js";
import { makeLoopInputs } from "./_helpers/make-inputs.js";

/*
 * #371 — a stream cut mid-flight discarded every token that had already arrived.
 *
 * Measured on a 200-chunk answer severed just before the terminator: the provider sent 1490 chars
 * and the consumer received 0. A truncated network stream is routine — proxy timeouts,
 * load-balancer idle limits, mobile links — and every one of them turned a mostly-complete answer
 * into nothing, the more so the longer the answer.
 *
 * The accumulator was not at fault: it yields each event as it arrives. The loss was in the loop's
 * catch, which set `finalText = ""` because the text collected before the throw escaped with the
 * exception. The run must still be reported errored — what the caller loses is the choice.
 */

function llmThatCutsAfter(events: LlmEvent[], cause: Error): LlmClient {
  return {
    name: "openai",
    async *stream(_request: LlmRequest): AsyncGenerator<LlmEvent, LlmFinish, void> {
      for (const event of events) yield event;
      throw cause;
    },
  };
}

function llmThatFinishes(events: LlmEvent[]): LlmClient {
  return {
    name: "openai",
    async *stream(_request: LlmRequest): AsyncGenerator<LlmEvent, LlmFinish, void> {
      for (const event of events) yield event;
      return { stopReason: "end_turn", text: "", toolCalls: [] };
    },
  };
}

const makeInputs = (llm: LlmClient, signal?: AbortSignal): AgentLoopInputs =>
  makeLoopInputs({
    agentId: "agent-test",
    runId: "run-test",
    model: { id: "openai/gpt-4o-mini" },
    llm,
    ...(signal !== undefined ? { signal } : {}),
  } as Partial<AgentLoopInputs>);

const makeCtx = (): LoopContext =>
  ({
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    tools: [],
    events: [],
    memorySystemPromptAdditions: undefined,
  }) as unknown as LoopContext;

const ANSWER: LlmEvent[] = [
  { type: "text_delta", text: "Hello " },
  { type: "text_delta", text: "world " },
  { type: "text_delta", text: "this is " },
];

it("keeps the text that already arrived when the stream is cut", async () => {
  const ctx = makeCtx();

  const out = await streamLlmTurn(
    makeInputs(llmThatCutsAfter(ANSWER, new Error("terminated"))),
    ctx,
  );

  expect(out.text).toBe("Hello world this is ");
  expect(ctx.finalText).toBe("Hello world this is ");
});

it("still reports the turn as errored", async () => {
  // The partial answer is a bonus, not a success. A caller must be able to tell that the provider
  // stopped early — handing back text with a clean status would be the worse bug in the other
  // direction.
  const ctx = makeCtx();

  const out = await streamLlmTurn(
    makeInputs(llmThatCutsAfter(ANSWER, new Error("terminated"))),
    ctx,
  );

  expect(out.errored).toBe(true);
  expect(out.stopReason).toBe("error");
  expect(ctx.error).toBeDefined();
});

it("keeps the text when the provider reports an in-band error event", async () => {
  // The other discard site: an `error` event mid-stream took the same `finalText = ""` path.
  const ctx = makeCtx();

  const out = await streamLlmTurn(
    makeInputs(
      llmThatFinishes([...ANSWER, { type: "error", message: "upstream exploded" } as LlmEvent]),
    ),
    ctx,
  );

  expect(out.text).toBe("Hello world this is ");
  expect(out.errored).toBe(true);
});

it("still reports [aborted] on a caller abort, and a clean turn unchanged", async () => {
  // The accepted cases (`testing.md` § 4.2). An abort is the caller's own decision and has its own
  // marker, which preserving partial text must not overwrite; and a normal turn must be untouched.
  const controller = new AbortController();
  controller.abort();
  const abortedCtx = makeCtx();
  await streamLlmTurn(
    makeInputs(llmThatCutsAfter(ANSWER, new Error("aborted")), controller.signal),
    abortedCtx,
  );
  expect(abortedCtx.finalText).toBe("[aborted]");

  const cleanCtx = makeCtx();
  const clean = await streamLlmTurn(makeInputs(llmThatFinishes(ANSWER)), cleanCtx);
  expect(clean.errored).toBe(false);
  // Trimmed by `stripThinkBlocks` on the clean path — pinned as-is rather than "fixed", since
  // changing what a successful turn returns is not what this issue is about.
  expect(clean.text).toBe("Hello world this is");
});

it("names the provider and endpoint when the SSE body is cut", async () => {
  // #371 item 2. Only the initial `fetch` was wrapped, so a body read that failed mid-stream
  // surfaced undici's raw "terminated" with `code: undefined` — while every other transport
  // failure on this path reads "openai transport failure on /v1/chat/completions: …". A caller
  // branching on `transport_failure` missed exactly the routine case.
  const { wrapTransportError } = await import("../../../src/internal/llm/transport-error.js");
  const { RateLimitError } = await import("../../../src/errors.js");

  const wrapped = wrapTransportError(new Error("terminated"), {
    providerId: "openai",
    endpoint: "/v1/chat/completions",
  }) as Error & { code?: string };

  expect(wrapped.message).toBe("openai transport failure on /v1/chat/completions: terminated");
  expect(wrapped.code).toBe("transport_failure");

  // And an SDK error keeps its own mapping — relabelling a 429 as a transport failure would be the
  // fix causing a worse bug than the one it closes.
  const rateLimited = new RateLimitError("rate limited");
  expect(wrapTransportError(rateLimited, { providerId: "openai", endpoint: "/v1" })).toBe(
    rateLimited,
  );
});
