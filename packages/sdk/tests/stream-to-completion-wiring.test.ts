import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { UnsupportedRunOperationError } from "../src/errors.js";
import type { SDKMessage } from "../src/types/messages.js";
import type { StreamToCompletionResult } from "../src/types/run.js";

/**
 * V3-4 (plan v34-stream-to-completion) — wiring of the streaming continuation
 * driver onto the agent surface. Local agents expose `streamToCompletion`
 * (yields SDKMessages live, returns the StreamToCompletionResult); cloud agents
 * throw `UnsupportedRunOperationError` (continuation is server-side).
 */
describe("LocalAgent.streamToCompletion wiring (V3-4)", () => {
  it("method exists and drives a real send to a done terminal (manual-next idiom)", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_stream_to_completion",
      model: { id: "openai/gpt-4o-mini" },
      local: {},
    });

    expect(typeof agent.streamToCompletion).toBe("function");

    const gen = agent.streamToCompletion?.("do the task") as AsyncGenerator<
      SDKMessage,
      StreamToCompletionResult
    >;
    let res = await gen.next();
    while (!res.done) res = await gen.next(); // EC-1: result is the return value
    expect(res.value.terminal).toBe("done");
    expect(res.value.rounds).toBe(0);
    expect(typeof res.value.lastResult.id).toBe("string");

    await agent.dispose();
  });

  it("cloud agents throw UnsupportedRunOperationError", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_stream_to_completion_cloud",
      model: { id: "openai/gpt-4o-mini" },
      cloud: {},
    });

    // Synchronous throw (mirrors CloudAgent.runToCompletion/fork), not a rejected promise.
    expect(() => agent.streamToCompletion?.("do the task")).toThrow(UnsupportedRunOperationError);

    await agent.dispose();
  });
});
