/**
 * usetheokit/theokit-sdk#383 — the three request-shaping gaps the issue measured, at the wire body.
 *
 * The issue captured our Responses request next to OpenAI Codex's against the same provider, model
 * and task: we sent a third of the bytes (24,691 c vs 76,331 c) and paid 2.8x the tokens (24,914 vs
 * 9,036), because ours carried no `prompt_cache_key` and no encrypted-reasoning carry, so every
 * round was a cold prompt that re-derived its own chain of thought.
 *
 * These tests read the body the transport actually serialises. The round-trip test drives two
 * `stream()` calls on ONE client, because a single call cannot show that ciphertext captured in
 * round 1 comes back in round 2 — and coming back is the entire point of asking for it.
 */
import { describe, expect, it } from "vitest";

import { buildResponsesBody, ResponsesApiClient } from "../../../src/internal/llm/responses.js";
import type { LlmEvent, LlmFinish, LlmRequest } from "../../../src/internal/llm/types.js";

const USER_TURN: LlmRequest["messages"] = [
  { role: "user", content: [{ type: "text", text: "read the file" }] },
];

/** Serialise SSE `event:`/`data:` records the way the Responses stream delivers them. */
function sse(events: ReadonlyArray<Record<string, unknown>>): string {
  return `${events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n`)
    .join("\n")}\n`;
}

/** A round that reasons (with ciphertext), then calls one tool. */
const REASON_THEN_CALL = sse([
  {
    type: "response.output_item.done",
    item: { type: "reasoning", id: "rs_round1", encrypted_content: "CIPHERTEXT-ROUND-1" },
  },
  {
    type: "response.output_item.added",
    item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "" },
  },
  {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "shell",
      arguments: '{"command":"ls"}',
    },
  },
  { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } },
]);

/** A round that just answers. */
const PLAIN_TEXT = sse([
  { type: "response.output_text.delta", delta: "done" },
  { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } },
]);

/** A fetch that records every serialised request body and replays the given SSE bodies in order. */
function recordingFetch(bodies: readonly string[]): {
  fetch: typeof fetch;
  sent: Array<Record<string, unknown>>;
} {
  const sent: Array<Record<string, unknown>> = [];
  let call = 0;
  const impl = (async (_url: unknown, init?: { body?: string }) => {
    sent.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
    const body = bodies[Math.min(call, bodies.length - 1)] ?? "";
    call += 1;
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetch: impl, sent };
}

/** Run one round to completion, discarding the events. */
async function drain(client: ResponsesApiClient, request: LlmRequest): Promise<LlmFinish> {
  const gen: AsyncGenerator<LlmEvent, LlmFinish, void> = client.stream(
    request,
    new AbortController().signal,
  );
  let step = await gen.next();
  while (step.done !== true) step = await gen.next();
  return step.value;
}

describe("usetheokit/theokit-sdk#383 — prompt_cache_key on the Responses body", () => {
  it("test_prompt_cache_key_reaches_the_wire_body", () => {
    const body = buildResponsesBody({
      model: "gpt-5.6",
      messages: USER_TURN,
      promptCacheKey: "theokit-0123456789abcdef0123456789abcdef",
    });

    expect(
      body.prompt_cache_key,
      "without this field the provider cannot match the cached prefix and every round is cold",
    ).toBe("theokit-0123456789abcdef0123456789abcdef");
  });

  it("test_body_omits_prompt_cache_key_when_the_request_carries_none", () => {
    const body = buildResponsesBody({ model: "gpt-5.6", messages: USER_TURN });

    expect(
      Object.hasOwn(body, "prompt_cache_key"),
      "a request with no key must produce the pre-#383 body, not a null field",
    ).toBe(false);
  });

  it("test_two_rounds_of_one_session_send_the_identical_key", async () => {
    const { fetch: impl, sent } = recordingFetch([REASON_THEN_CALL, PLAIN_TEXT]);
    const client = new ResponsesApiClient({ apiKey: "sk-test", fetch: impl });
    const request: LlmRequest = {
      model: "gpt-5.6",
      messages: USER_TURN,
      promptCacheKey: "theokit-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };

    await drain(client, request);
    await drain(client, request);

    expect(sent).toHaveLength(2);
    expect(
      sent[1]?.prompt_cache_key,
      `round 2 sent ${String(sent[1]?.prompt_cache_key)} where round 1 sent ` +
        `${String(sent[0]?.prompt_cache_key)} — a key that changes per round caches nothing`,
    ).toBe(sent[0]?.prompt_cache_key);
  });
});

describe("usetheokit/theokit-sdk#383 — store stays false", () => {
  it("test_store_is_false_so_the_provider_retains_nothing", () => {
    const body = buildResponsesBody({ model: "gpt-5.6", messages: USER_TURN });

    // Codex sends `true`. This pins the opposite choice: SDK requests routinely carry a consumer's
    // source code and shell output, and `store: true` would ask the provider to retain it. Nothing
    // #383 asked for depends on it — `prompt_cache_key` caches the prefix and the encrypted-reasoning
    // carry replaces server-side state. Change this only with the privacy argument answered.
    expect(body.store, "store must stay false — see the docblock in responses.ts").toBe(false);
  });
});

describe("usetheokit/theokit-sdk#383 — encrypted reasoning carry", () => {
  it("test_encrypted_reasoning_off_leaves_the_request_as_it_was", () => {
    const body = buildResponsesBody({
      model: "gpt-5.6",
      messages: USER_TURN,
      reasoning: { effort: "medium" },
    });

    expect(
      Object.hasOwn(body, "include"),
      "a provider that never declared support must not be sent `include`",
    ).toBe(false);
    expect(
      body.reasoning,
      "`reasoning.context` is not a public Responses-API field; a strict provider answers 400",
    ).toEqual({ effort: "medium" });
  });

  it("test_encrypted_reasoning_on_adds_include_and_all_turns_context", () => {
    const body = buildResponsesBody(
      { model: "gpt-5.6", messages: USER_TURN, reasoning: { effort: "medium" } },
      { encryptedReasoning: true },
    );

    expect(body.include, "the ciphertext has to be requested before it can be replayed").toEqual([
      "reasoning.encrypted_content",
    ]);
    expect(body.reasoning, "the effort the caller asked for must survive").toEqual({
      effort: "medium",
      context: "all_turns",
    });
  });

  it("test_reasoning_context_is_not_invented_without_an_effort", () => {
    const body = buildResponsesBody(
      { model: "gpt-5.6", messages: USER_TURN },
      { encryptedReasoning: true },
    );

    expect(
      Object.hasOwn(body, "reasoning"),
      "a `reasoning` object holding nothing but `context` is a shape no captured request exhibits",
    ).toBe(false);
    expect(body.include, "`include` alone is still valid and still useful").toEqual([
      "reasoning.encrypted_content",
    ]);
  });

  it("test_captured_ciphertext_is_replayed_before_the_tool_call_it_produced", async () => {
    const { fetch: impl, sent } = recordingFetch([REASON_THEN_CALL, PLAIN_TEXT]);
    const client = new ResponsesApiClient({
      apiKey: "sk-test",
      fetch: impl,
      encryptedReasoning: true,
    });

    const first = await drain(client, { model: "gpt-5.6", messages: USER_TURN });
    await drain(client, {
      model: "gpt-5.6",
      messages: [
        ...USER_TURN,
        { role: "assistant", content: first.toolCalls },
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "call_1", content: "file.txt" }],
        },
      ],
    });

    expect(first.toolCalls[0]?.id, "the fixture must produce the call the replay keys on").toBe(
      "call_1",
    );
    const input = sent[1]?.input as Array<Record<string, unknown>>;
    const reasoningAt = input.findIndex((item) => item.type === "reasoning");
    const callAt = input.findIndex((item) => item.type === "function_call");
    expect(
      input[reasoningAt],
      `round 2 input carried no replayed reasoning: ${JSON.stringify(input)}`,
    ).toEqual({
      type: "reasoning",
      id: "rs_round1",
      encrypted_content: "CIPHERTEXT-ROUND-1",
      summary: [],
    });
    expect(
      reasoningAt,
      `reasoning at index ${reasoningAt} must precede its call at ${callAt} — the provider rejects ` +
        "a reasoning item that does not sit immediately before its own output",
    ).toBe(callAt - 1);
  });

  it("test_a_round_whose_call_left_history_replays_nothing", async () => {
    const { fetch: impl, sent } = recordingFetch([REASON_THEN_CALL, PLAIN_TEXT]);
    const client = new ResponsesApiClient({
      apiKey: "sk-test",
      fetch: impl,
      encryptedReasoning: true,
    });

    await drain(client, { model: "gpt-5.6", messages: USER_TURN });
    await drain(client, { model: "gpt-5.6", messages: USER_TURN });

    const input = sent[1]?.input as Array<Record<string, unknown>>;
    expect(
      input.some((item) => item.type === "reasoning"),
      "ciphertext must ride WITH its tool call — a compacted-away call takes its reasoning with it",
    ).toBe(false);
  });
});
