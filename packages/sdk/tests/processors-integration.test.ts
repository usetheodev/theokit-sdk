import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../src/index.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { RunEvent } from "../src/types/run-events.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE24 — guardrail processors wired end-to-end through `agent.send()` (fixture
 * runtime). Input `block` aborts before the model (tripwire + run-event, no
 * reply); input `rewrite` flows to the next processor; output `redact`
 * transforms the returned text.
 */
describe("SE24 — processors wired into send()", () => {
  let agent: SDKAgent | undefined;
  afterEach(async () => {
    await agent?.dispose();
    agent = undefined;
  });

  it("an input block aborts before the model: tripwire result + run-event, no reply", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se24_block",
      model: { id: "openai/gpt-4o-mini" },
      inputProcessors: [
        { id: "pii-guard", processInput: (ctx) => ctx.abort("blocked: contains a secret") },
      ],
    });
    const events: RunEvent[] = [];
    const run = await agent.send("my card is 4543 1374 5089 4332", {
      onRunEvent: (e) => events.push(e),
    });
    const result = await run.wait();

    expect(result.status).toBe("cancelled");
    expect(result.tripwire).toEqual({
      reason: "blocked: contains a secret",
      processorId: "pii-guard",
    });
    expect(result.result).toBeUndefined(); // the model never ran
    expect(events).toContainEqual({
      type: "tripwire",
      reason: "blocked: contains a secret",
      processorId: "pii-guard",
    });
  });

  it("an input rewrite flows to the next processor (real send path)", async () => {
    const onViolation = vi.fn();
    agent = await Agent.create({
      apiKey: "theo_test_se24_rewrite",
      model: { id: "openai/gpt-4o-mini" },
      inputProcessors: [
        { id: "redactor", processInput: (ctx) => ctx.message.replace("SECRET", "[x]") },
        {
          id: "blocker",
          processInput: (ctx) => (ctx.message.includes("SECRET") ? ctx.abort("leak") : ctx.message),
          onViolation,
        },
      ],
    });
    // The redactor removes SECRET before the blocker sees it → the run finishes.
    const run = await agent.send("my SECRET stays hidden");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(result.tripwire).toBeUndefined();
    expect(onViolation).not.toHaveBeenCalled();
  });

  it("an output redact transforms the returned text", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se24_redact",
      model: { id: "openai/gpt-4o-mini" },
      outputProcessors: [{ id: "tagger", processOutput: (ctx) => `${ctx.text} [checked]` }],
    });
    const run = await agent.send("hello");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    // The fixture assistant text is "Done." — the output processor appends a tag.
    expect(result.result).toBe("Done. [checked]");
  });

  it("an output block turns a finished run into a tripwire + emits a tripwire event", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se24_oblock",
      model: { id: "openai/gpt-4o-mini" },
      outputProcessors: [{ id: "leak-guard", processOutput: (ctx) => ctx.abort("output leaked") }],
    });
    const events: RunEvent[] = [];
    const run = await agent.send("hello", { onRunEvent: (e) => events.push(e) });
    const result = await run.wait();
    expect(result.status).toBe("cancelled");
    expect(result.tripwire).toEqual({ reason: "output leaked", processorId: "leak-guard" });
    expect(result.result).toBeUndefined();
    expect(events).toContainEqual({
      type: "tripwire",
      reason: "output leaked",
      processorId: "leak-guard",
    });
  });

  it("a shared processor listed in BOTH arrays fires onViolation once per phase", async () => {
    const onViolation = vi.fn();
    const proc = {
      id: "dual",
      processInput: (ctx: { message: string; warn: (m: string) => void }) => {
        ctx.warn("in");
        return ctx.message;
      },
      processOutput: (ctx: { text: string; warn: (m: string) => void }) => {
        ctx.warn("out");
        return ctx.text;
      },
      onViolation,
    };
    agent = await Agent.create({
      apiKey: "theo_test_se24_dual",
      model: { id: "openai/gpt-4o-mini" },
      inputProcessors: [proc],
      outputProcessors: [proc],
    });
    await (await agent.send("hello")).wait();
    expect(onViolation).toHaveBeenCalledTimes(2);
    expect(onViolation).toHaveBeenCalledWith({ processorId: "dual", message: "in" });
    expect(onViolation).toHaveBeenCalledWith({ processorId: "dual", message: "out" });
  });

  it("no processors ⇒ unchanged (back-compat)", async () => {
    agent = await Agent.create({
      apiKey: "theo_test_se24_none",
      model: { id: "openai/gpt-4o-mini" },
    });
    const run = await agent.send("hello");
    const result = await run.wait();
    expect(result.status).toBe("finished");
    expect(result.result).toBe("Done.");
    expect(result.tripwire).toBeUndefined();
  });
});
