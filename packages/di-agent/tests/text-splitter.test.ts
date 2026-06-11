import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { readTextSplitterMetadata, TextSplitter } from "../src/decorators/text-splitter.js";

describe("@TextSplitter", () => {
  it("stores metadata on property", () => {
    class A {
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) p!: unknown;
    }
    expect(readTextSplitterMetadata(A).get("p")).toEqual({
      strategy: "recursive",
      chunkSize: 1000,
    });
  });
  it("supports multiple properties", () => {
    class A {
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) a!: unknown;
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) b!: unknown;
    }
    expect(readTextSplitterMetadata(A).size).toBe(2);
  });
  it("returns empty map without decorator", () => {
    class Plain {}
    expect(readTextSplitterMetadata(Plain).size).toBe(0);
  });
  it("isolates between classes", () => {
    class A {
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) p!: unknown;
    }
    class B {
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) p!: unknown;
    }
    expect(readTextSplitterMetadata(A).size).toBe(1);
    expect(readTextSplitterMetadata(B).size).toBe(1);
  });
  it("preserves all options", () => {
    class A {
      @TextSplitter({ strategy: "recursive", chunkSize: 1000 }) p!: unknown;
    }
    const meta = readTextSplitterMetadata(A).get("p");
    expect(meta).toBeDefined();
  });
  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
