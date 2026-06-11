import { describe, expect, it } from "vitest";
import {
  createAcpDescriptor,
  messageToAcp,
  sessionToAcp,
  toolEventToAcp,
} from "../../src/infra/acp-bridge.js";

describe("createAcpDescriptor", () => {
  it("creates descriptor with name and version", () => {
    const desc = createAcpDescriptor("my-agent");
    expect(desc.name).toBe("my-agent");
    expect(desc.version).toBe("1.0.0");
    expect(desc.description).toContain("my-agent");
  });
});

describe("sessionToAcp", () => {
  it("converts session to ACP record", () => {
    const result = sessionToAcp({ id: "s1", title: "Test Session" });
    expect(result).toEqual({
      type: "acp.session",
      id: "s1",
      title: "Test Session",
    });
  });
});

describe("messageToAcp", () => {
  it("converts message to ACP record", () => {
    const result = messageToAcp({ role: "user", content: "hello" });
    expect(result).toEqual({
      type: "acp.message",
      role: "user",
      content: "hello",
    });
  });
});

describe("toolEventToAcp", () => {
  it("converts tool event to ACP record", () => {
    const result = toolEventToAcp("shell_exec", { cmd: "ls" }, "file1\nfile2");
    expect(result).toEqual({
      type: "acp.tool_event",
      tool: "shell_exec",
      input: { cmd: "ls" },
      output: "file1\nfile2",
    });
  });
});
