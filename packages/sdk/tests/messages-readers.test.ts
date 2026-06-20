import { describe, expect, it } from "vitest";

import { assistantText, costAmountUsd, extractToolUses } from "../src/messages.js";
import type {
  SDKAssistantMessage,
  SDKMessage,
  TextBlock,
  ToolUseBlock,
} from "../src/types/messages.js";
import type { CostBreakdown, CostStatus } from "../src/types/usage.js";

/**
 * M1-5 — pure `SDKMessage` readers (`assistantText`, `extractToolUses`,
 * `costAmountUsd`). Promotes the first-party hand-roll
 * `../theocode/server/lib/sdk-mappers.ts` onto the SDK's own types. Design:
 * blueprint m1-sdkmessage-readers ADRs D1-D3.
 */

const text = (t: string): TextBlock => ({ type: "text", text: t });
const toolUse = (name: string): ToolUseBlock => ({
  type: "tool_use",
  id: `tu-${name}`,
  name,
  input: {},
});

function assistant(content: Array<TextBlock | ToolUseBlock>): SDKAssistantMessage {
  return {
    type: "assistant",
    agent_id: "agent-x",
    run_id: "run-1",
    message: { role: "assistant", content },
  };
}

function cost(amountUsd: number | undefined, status: CostStatus): CostBreakdown {
  return {
    amountUsd,
    status,
    currency: "USD",
    source: "unknown",
    pricingVersion: undefined,
  };
}

describe("assistantText (M1-5)", () => {
  it("test_assistantText_concatenates_text_blocks", () => {
    expect(assistantText(assistant([text("hello "), text("world")]))).toBe("hello world");
  });

  it("test_assistantText_empty_for_non_assistant", () => {
    const sys: SDKMessage = {
      type: "system",
      agent_id: "agent-x",
      run_id: "run-1",
    } as unknown as SDKMessage;
    expect(assistantText(sys)).toBe("");
  });

  it("test_assistantText_ignores_tool_use_blocks", () => {
    expect(assistantText(assistant([text("a"), toolUse("read"), text("b")]))).toBe("ab");
  });

  it("test_assistantText_empty_content_array_returns_empty_string", () => {
    expect(assistantText(assistant([]))).toBe("");
  });

  it("test_assistantText_joins_multiple_text_blocks_in_order", () => {
    expect(assistantText(assistant([text("a"), toolUse("x"), text("b")]))).toBe("ab");
  });
});

describe("extractToolUses (M1-5)", () => {
  it("test_extractToolUses_returns_tool_use_blocks", () => {
    const out = extractToolUses(assistant([text("hi"), toolUse("read"), toolUse("write")]));
    expect(out.map((b) => b.name)).toEqual(["read", "write"]);
  });

  it("test_extractToolUses_empty_for_non_assistant", () => {
    const user: SDKMessage = {
      type: "user",
      agent_id: "agent-x",
      run_id: "run-1",
      message: { role: "user", content: [text("hi")] },
    };
    expect(extractToolUses(user)).toEqual([]);
  });

  it("test_extractToolUses_empty_content_array_returns_empty", () => {
    expect(extractToolUses(assistant([]))).toEqual([]);
  });

  it("test_extractToolUses_empty_for_tool_call_lifecycle_message", () => {
    // D2 boundary: the SDKToolUseMessage lifecycle event (type:"tool_call") is a
    // SEPARATE stream — extractToolUses reads assistant content blocks only.
    const lifecycle: SDKMessage = {
      type: "tool_call",
      agent_id: "agent-x",
      run_id: "run-1",
      call_id: "c1",
      name: "read",
      status: "running",
    };
    expect(extractToolUses(lifecycle)).toEqual([]);
  });
});

describe("costAmountUsd (M1-5)", () => {
  it("test_costAmountUsd_preserves_undefined_never_zero", () => {
    expect(costAmountUsd(cost(undefined, "unknown"))).toBeUndefined();
  });

  it("test_costAmountUsd_preserves_real_zero", () => {
    expect(costAmountUsd(cost(0, "included"))).toBe(0);
  });

  it("test_costAmountUsd_undefined_cost_returns_undefined", () => {
    expect(costAmountUsd(undefined)).toBeUndefined();
  });
});

describe("readers purity (M1-5)", () => {
  it("test_readers_do_not_mutate_inputs", () => {
    const msg = assistant([text("a"), toolUse("read")]);
    const snapshot = JSON.stringify(msg);
    const c = cost(1.23, "actual");
    const cSnapshot = JSON.stringify(c);
    assistantText(msg);
    extractToolUses(msg);
    costAmountUsd(c);
    expect(JSON.stringify(msg)).toBe(snapshot);
    expect(JSON.stringify(c)).toBe(cSnapshot);
  });
});
