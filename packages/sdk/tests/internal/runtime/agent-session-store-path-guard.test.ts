/**
 * Tests for path-guard wiring in agent-session-store (T3.3, ADRs D79-D81).
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import { sessionFilePath } from "../../../src/internal/runtime/agent-session-store.js";

describe("sessionFilePath — path-guard wiring (T3.3)", () => {
  it("rejects agentId with '..'", () => {
    expect(() => sessionFilePath("/tmp/cwd", "../etc/passwd")).toThrow(ConfigurationError);
  });

  it("rejects agentId with slash", () => {
    expect(() => sessionFilePath("/tmp/cwd", "foo/bar")).toThrow(/invalid characters/);
  });

  it("rejects empty agentId", () => {
    expect(() => sessionFilePath("/tmp/cwd", "")).toThrow(/length out of range/);
  });

  it("accepts local agent-<uuid> format", () => {
    const path = sessionFilePath("/tmp/cwd", "agent-02897280-f155-4044-bbd6-0cc5ef8bf194");
    expect(path).toContain("agent-02897280-f155-4044-bbd6-0cc5ef8bf194/messages.jsonl");
  });

  it("accepts cloud bc-<uuid> format", () => {
    const path = sessionFilePath("/tmp/cwd", "bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa");
    expect(path).toContain("bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa/messages.jsonl");
  });

  it("lowercases mixed-case ID (tg-dogfood-chat-A → tg-dogfood-chat-a)", () => {
    const path = sessionFilePath("/tmp/cwd", "tg-dogfood-chat-A");
    expect(path).toContain("tg-dogfood-chat-a/messages.jsonl");
  });
});
