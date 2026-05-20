/**
 * Tests for createExclusive O_EXCL semantics (T2.1, ADR D82).
 */

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createExclusive } from "../../../src/internal/persistence/exclusive-create.js";

describe("createExclusive (T2.1)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "excl-test-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates when absent", async () => {
    const path = join(tmpRoot, "new.txt");
    const won = await createExclusive(path, "hello");
    expect(won).toBe(true);
  });

  it("returns false when exists", async () => {
    const path = join(tmpRoot, "existing.txt");
    writeFileSync(path, "preexisting");
    const won = await createExclusive(path, "ignored");
    expect(won).toBe(false);
  });

  it("propagates ENOENT for missing parent", async () => {
    const path = join(tmpRoot, "missing-parent", "file.txt");
    await expect(createExclusive(path, "data")).rejects.toThrow(/ENOENT/);
  });

  it("concurrent: only one of 10 racers wins", async () => {
    const path = join(tmpRoot, "race.txt");
    const racers = Array.from({ length: 10 }, (_, i) => createExclusive(path, `r-${i}`));
    const results = await Promise.all(racers);
    const winners = results.filter((r) => r === true);
    expect(winners).toHaveLength(1);
  });

  it("EC-2: default mode is 0o600 (owner-only)", async () => {
    const path = join(tmpRoot, "default-mode.txt");
    await createExclusive(path, "secret");
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("EC-2: explicit mode 0o644 overrides default", async () => {
    const path = join(tmpRoot, "public-mode.txt");
    await createExclusive(path, "public", { mode: 0o644 });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o644);
  });
});
