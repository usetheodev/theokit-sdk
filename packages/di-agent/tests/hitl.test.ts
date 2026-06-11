import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { Hitl, readHitlMetadata } from "../src/decorators/hitl.js";

describe("@Hitl", () => {
  it("stores tools list and method key", () => {
    class MyAgent {
      @Hitl({ tools: ["execute"] })
      async approve(_name: string, _input: unknown): Promise<boolean> {
        return true;
      }
    }
    const meta = readHitlMetadata(MyAgent);
    expect(meta?.tools).toEqual(["execute"]);
    expect(meta?.methodKey).toBe("approve");
  });

  it("stores custom timeoutMs", () => {
    class A {
      @Hitl({ tools: ["deploy"], timeoutMs: 60_000 })
      async check(): Promise<boolean> {
        return false;
      }
    }
    expect(readHitlMetadata(A)?.timeoutMs).toBe(60_000);
  });

  it("defaults timeoutMs to undefined", () => {
    class A {
      @Hitl({ tools: ["exec"] })
      async approve(): Promise<boolean> {
        return true;
      }
    }
    expect(readHitlMetadata(A)?.timeoutMs).toBeUndefined();
  });

  it("supports multiple tools", () => {
    class A {
      @Hitl({ tools: ["execute", "writeFile", "deploy"] })
      async approve(): Promise<boolean> {
        return true;
      }
    }
    expect(readHitlMetadata(A)?.tools).toHaveLength(3);
  });

  it("returns undefined for undecorated class", () => {
    class Plain {}
    expect(readHitlMetadata(Plain)).toBeUndefined();
  });

  it("last @Hitl wins (one per class)", () => {
    class A {
      @Hitl({ tools: ["first"] })
      async first(): Promise<boolean> {
        return true;
      }

      @Hitl({ tools: ["second"] })
      async second(): Promise<boolean> {
        return false;
      }
    }
    const meta = readHitlMetadata(A);
    expect(meta?.tools).toEqual(["second"]);
    expect(meta?.methodKey).toBe("second");
  });

  it("isolates metadata between classes", () => {
    class A {
      @Hitl({ tools: ["a"] })
      async approve(): Promise<boolean> {
        return true;
      }
    }
    class B {
      @Hitl({ tools: ["b"] })
      async approve(): Promise<boolean> {
        return true;
      }
    }
    expect(readHitlMetadata(A)?.tools).toEqual(["a"]);
    expect(readHitlMetadata(B)?.tools).toEqual(["b"]);
  });

  it("works on sync method (EC-3)", () => {
    class A {
      @Hitl({ tools: ["exec"] })
      approveSync(_name: string): boolean {
        return true;
      }
    }
    const meta = readHitlMetadata(A);
    expect(meta?.methodKey).toBe("approveSync");
    expect(meta?.tools).toEqual(["exec"]);
  });

  it("preserves method key as symbol", () => {
    const sym = Symbol("approve");
    class A {
      @Hitl({ tools: ["exec"] })
      [sym](): boolean {
        return true;
      }
    }
    expect(readHitlMetadata(A)?.methodKey).toBe(sym);
  });
});
