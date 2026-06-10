import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { readSubAgentMetadata, SubAgent } from "../src/decorators/sub-agent.js";

describe("@SubAgent", () => {
  const baseSpec = {
    name: "researcher",
    description: "Research assistant",
    instructions: "Answer concisely.",
  };

  it("stores spec on decorated property", () => {
    class MyAgent {
      @SubAgent(baseSpec)
      researcher!: unknown;
    }
    const meta = readSubAgentMetadata(MyAgent);
    expect(meta.get("researcher")).toEqual(baseSpec);
  });

  it("defaults maxDelegationDepth to undefined (runtime default)", () => {
    class A {
      @SubAgent(baseSpec)
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.maxDelegationDepth).toBeUndefined();
  });

  it("supports multiple subagent properties", () => {
    class A {
      @SubAgent({ ...baseSpec, name: "researcher" })
      researcher!: unknown;

      @SubAgent({ ...baseSpec, name: "coder" })
      coder!: unknown;
    }
    const meta = readSubAgentMetadata(A);
    expect(meta.size).toBe(2);
  });

  it("preserves custom model", () => {
    class A {
      @SubAgent({ ...baseSpec, model: "claude-opus-4" })
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.model).toBe("claude-opus-4");
  });

  it("preserves maxDelegationDepth", () => {
    class A {
      @SubAgent({ ...baseSpec, maxDelegationDepth: 5 })
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.maxDelegationDepth).toBe(5);
  });

  it("returns empty map for undecorated class", () => {
    class Plain {}
    expect(readSubAgentMetadata(Plain).size).toBe(0);
  });

  it("isolates metadata between classes", () => {
    class A {
      @SubAgent({ ...baseSpec, name: "a" })
      r!: unknown;
    }
    class B {
      @SubAgent({ ...baseSpec, name: "b" })
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.name).toBe("a");
    expect(readSubAgentMetadata(B).get("r")?.name).toBe("b");
  });

  it("preserves instructions verbatim", () => {
    const instructions = "You are a\nmulti-line\ninstructions agent.";
    class A {
      @SubAgent({ ...baseSpec, instructions })
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.instructions).toBe(instructions);
  });

  it("stores empty instructions without error (EC-4)", () => {
    class A {
      @SubAgent({ ...baseSpec, instructions: "" })
      r!: unknown;
    }
    expect(readSubAgentMetadata(A).get("r")?.instructions).toBe("");
  });
});
