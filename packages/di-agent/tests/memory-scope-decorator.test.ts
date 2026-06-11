import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { MemoryScopeDecorator, readMemoryScopeMetadata } from "../src/decorators/memory-scope.js";

describe("@MemoryScopeDecorator", () => {
  it("stores path on decorated property", () => {
    class MyAgent {
      @MemoryScopeDecorator({ path: "/crew/research" })
      scope!: unknown;
    }
    expect(readMemoryScopeMetadata(MyAgent).get("scope")).toEqual({
      path: "/crew/research",
    });
  });

  it("supports multiple scoped properties", () => {
    class MyAgent {
      @MemoryScopeDecorator({ path: "/crew/research" })
      research!: unknown;

      @MemoryScopeDecorator({ path: "/crew/coding" })
      coding!: unknown;
    }
    const meta = readMemoryScopeMetadata(MyAgent);
    expect(meta.size).toBe(2);
    expect(meta.get("research")?.path).toBe("/crew/research");
    expect(meta.get("coding")?.path).toBe("/crew/coding");
  });

  it("returns empty map for undecorated class", () => {
    class Plain {}
    expect(readMemoryScopeMetadata(Plain).size).toBe(0);
  });

  it("isolates between classes", () => {
    class A {
      @MemoryScopeDecorator({ path: "/a" })
      s!: unknown;
    }
    class B {
      @MemoryScopeDecorator({ path: "/b" })
      s!: unknown;
    }
    expect(readMemoryScopeMetadata(A).get("s")?.path).toBe("/a");
    expect(readMemoryScopeMetadata(B).get("s")?.path).toBe("/b");
  });

  it("preserves deep paths", () => {
    class A {
      @MemoryScopeDecorator({ path: "/company/engineering/research/long-term" })
      s!: unknown;
    }
    expect(readMemoryScopeMetadata(A).get("s")?.path).toBe(
      "/company/engineering/research/long-term",
    );
  });

  it("ensures reflect-metadata loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
