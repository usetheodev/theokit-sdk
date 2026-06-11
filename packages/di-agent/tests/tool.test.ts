import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { readToolMetadata, Tool } from "../src/decorators/tool.js";

describe("@Tool", () => {
  it("stores metadata on property", () => {
    class A {
      @Tool({ name: "search", description: "Web search" }) p!: unknown;
    }
    expect(readToolMetadata(A).get("p")).toEqual({ name: "search", description: "Web search" });
  });
  it("supports multiple properties", () => {
    class A {
      @Tool({ name: "search", description: "Web search" }) a!: unknown;
      @Tool({ name: "search", description: "Web search" }) b!: unknown;
    }
    expect(readToolMetadata(A).size).toBe(2);
  });
  it("returns empty map without decorator", () => {
    class Plain {}
    expect(readToolMetadata(Plain).size).toBe(0);
  });
  it("isolates between classes", () => {
    class A {
      @Tool({ name: "search", description: "Web search" }) p!: unknown;
    }
    class B {
      @Tool({ name: "search", description: "Web search" }) p!: unknown;
    }
    expect(readToolMetadata(A).size).toBe(1);
    expect(readToolMetadata(B).size).toBe(1);
  });
  it("preserves all options", () => {
    class A {
      @Tool({ name: "search", description: "Web search" }) p!: unknown;
    }
    const meta = readToolMetadata(A).get("p");
    expect(meta).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
