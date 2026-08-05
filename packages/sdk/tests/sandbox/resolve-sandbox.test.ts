import { describe, expect, it } from "vitest";

import {
  type ExecuteResult,
  resolveSandbox,
  SandboxBackend,
  type SandboxProvider,
} from "../../src/sandbox/index.js";

/** Minimal in-memory sandbox — proves resolveSandbox returns/awaits a backend (mirrors resolveFilesystem). */
class FakeSandbox extends SandboxBackend {
  async execute(): Promise<ExecuteResult> {
    return { stdout: "ok", stderr: "", exitCode: 0, timedOut: false };
  }
  async uploadFile(): Promise<void> {}
}

describe("resolveSandbox (mirrors resolveFilesystem / resolveInteractive)", () => {
  it("returns a backend instance passed directly", async () => {
    const backend = new FakeSandbox();
    expect(await resolveSandbox(backend, {})).toBe(backend);
  });

  it("invokes a per-request resolver with the ctx", async () => {
    const backend = new FakeSandbox();
    let seen: unknown;
    const provider: SandboxProvider<{ role: string }> = (ctx) => {
      seen = ctx;
      return backend;
    };
    expect(await resolveSandbox(provider, { role: "admin" })).toBe(backend);
    expect(seen).toEqual({ role: "admin" });
  });

  it("awaits an async resolver", async () => {
    const backend = new FakeSandbox();
    const provider: SandboxProvider = () => Promise.resolve(backend);
    expect(await resolveSandbox(provider, undefined)).toBe(backend);
  });
});
