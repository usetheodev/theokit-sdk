import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Reranker, readRerankerMetadata } from "../src/decorators/reranker.js";

describe("@Reranker", () => {
  it("stores metadata on property", () => {
    class A {
      @Reranker({ provider: "cohere" }) p!: unknown;
    }
    expect(readRerankerMetadata(A).get("p")).toEqual({ provider: "cohere" });
  });
  it("supports multiple properties", () => {
    class A {
      @Reranker({ provider: "cohere" }) a!: unknown;
      @Reranker({ provider: "cohere" }) b!: unknown;
    }
    expect(readRerankerMetadata(A).size).toBe(2);
  });
  it("returns empty map without decorator", () => {
    class Plain {}
    expect(readRerankerMetadata(Plain).size).toBe(0);
  });
  it("isolates between classes", () => {
    class A {
      @Reranker({ provider: "cohere" }) p!: unknown;
    }
    class B {
      @Reranker({ provider: "cohere" }) p!: unknown;
    }
    expect(readRerankerMetadata(A).size).toBe(1);
    expect(readRerankerMetadata(B).size).toBe(1);
  });
  it("preserves all options", () => {
    class A {
      @Reranker({ provider: "cohere" }) p!: unknown;
    }
    const meta = readRerankerMetadata(A).get("p");
    expect(meta).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
