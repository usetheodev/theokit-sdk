import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Retriever, readRetrieverMetadata } from "../src/decorators/retriever.js";

describe("@Retriever", () => {
  it("stores metadata on property", () => {
    class A {
      @Retriever({ topK: 10 }) p!: unknown;
    }
    expect(readRetrieverMetadata(A).get("p")).toEqual({ topK: 10 });
  });
  it("supports multiple properties", () => {
    class A {
      @Retriever({ topK: 10 }) a!: unknown;
      @Retriever({ topK: 10 }) b!: unknown;
    }
    expect(readRetrieverMetadata(A).size).toBe(2);
  });
  it("returns empty map without decorator", () => {
    class Plain {}
    expect(readRetrieverMetadata(Plain).size).toBe(0);
  });
  it("isolates between classes", () => {
    class A {
      @Retriever({ topK: 10 }) p!: unknown;
    }
    class B {
      @Retriever({ topK: 10 }) p!: unknown;
    }
    expect(readRetrieverMetadata(A).size).toBe(1);
    expect(readRetrieverMetadata(B).size).toBe(1);
  });
  it("preserves all options", () => {
    class A {
      @Retriever({ topK: 10 }) p!: unknown;
    }
    const meta = readRetrieverMetadata(A).get("p");
    expect(meta).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
