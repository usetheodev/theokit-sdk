/**
 * RED tests for T1.1 — `atomicWriteJson<T>` typed helper.
 * Includes EC-4 (auto-mkdir parent directory).
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteJson } from "../../../src/internal/persistence/atomic-write.js";

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes JSON with default 2-space indent", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { foo: "bar", nested: { count: 1 } });
    const content = readFileSync(path, "utf-8");
    expect(content).toBe('{\n  "foo": "bar",\n  "nested": {\n    "count": 1\n  }\n}\n');
  });

  it("appends trailing newline by default", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 });
    const content = readFileSync(path, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("respects indent option", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 }, { indent: 4 });
    expect(readFileSync(path, "utf-8")).toBe('{\n    "a": 1\n}\n');
  });

  it("respects trailingNewline=false option", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 }, { trailingNewline: false });
    const content = readFileSync(path, "utf-8");
    expect(content.endsWith("\n")).toBe(false);
    expect(content).toBe('{\n  "a": 1\n}');
  });

  it("throws TypeError on undefined data", async () => {
    const path = join(dir, "config.json");
    await expect(atomicWriteJson(path, undefined)).rejects.toThrow(TypeError);
  });

  it("EC-4: auto-creates missing parent directories", async () => {
    const path = join(dir, "nested", "deep", "config.json");
    await atomicWriteJson(path, { a: 1 });
    expect(readFileSync(path, "utf-8")).toBe('{\n  "a": 1\n}\n');
  });

  it("leaves no .tmp files on success", async () => {
    const path = join(dir, "config.json");
    await atomicWriteJson(path, { a: 1 });
    const leftovers = readdirSync(dir).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("propagates circular reference errors", async () => {
    const path = join(dir, "config.json");
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    await expect(atomicWriteJson(path, circular)).rejects.toThrow();
  });
});
