import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { readSandboxMetadata, UseSandbox } from "../src/decorators/use-sandbox.js";

describe("@UseSandbox", () => {
  it("stores metadata on decorated property", () => {
    class MyAgent {
      @UseSandbox({ backend: "docker" })
      sandbox!: unknown;
    }
    const meta = readSandboxMetadata(MyAgent);
    expect(meta.get("sandbox")).toEqual({ backend: "docker" });
  });

  it("stores default empty options", () => {
    class MyAgent {
      @UseSandbox()
      sandbox!: unknown;
    }
    expect(readSandboxMetadata(MyAgent).get("sandbox")).toEqual({});
  });

  it("supports multiple decorated properties", () => {
    class MyAgent {
      @UseSandbox({ backend: "local" })
      localSandbox!: unknown;

      @UseSandbox({ backend: "docker" })
      dockerSandbox!: unknown;
    }
    const meta = readSandboxMetadata(MyAgent);
    expect(meta.size).toBe(2);
    expect(meta.get("localSandbox")?.backend).toBe("local");
    expect(meta.get("dockerSandbox")?.backend).toBe("docker");
  });

  it("preserves workDir option", () => {
    class A {
      @UseSandbox({ workDir: "/tmp/sandbox" })
      s!: unknown;
    }
    expect(readSandboxMetadata(A).get("s")?.workDir).toBe("/tmp/sandbox");
  });

  it("returns empty map for undecorated class", () => {
    class Plain {}
    expect(readSandboxMetadata(Plain).size).toBe(0);
  });

  it("isolates metadata between classes", () => {
    class A {
      @UseSandbox({ backend: "a" })
      s!: unknown;
    }
    class B {
      @UseSandbox({ backend: "b" })
      s!: unknown;
    }
    expect(readSandboxMetadata(A).get("s")?.backend).toBe("a");
    expect(readSandboxMetadata(B).get("s")?.backend).toBe("b");
  });

  it("preserves timeoutMs option", () => {
    class A {
      @UseSandbox({ timeoutMs: 60_000 })
      s!: unknown;
    }
    expect(readSandboxMetadata(A).get("s")?.timeoutMs).toBe(60_000);
  });

  it("accepts custom backend names", () => {
    class A {
      @UseSandbox({ backend: "e2b" })
      s!: unknown;
    }
    expect(readSandboxMetadata(A).get("s")?.backend).toBe("e2b");
  });

  it("ensures reflect-metadata is loaded", () => {
    expect(typeof Reflect.defineMetadata).toBe("function");
  });
});
