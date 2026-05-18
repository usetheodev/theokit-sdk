/**
 * Tests for migrate-sqlite-to-lance logger redaction (T1.4, ADR D68).
 *
 * The migration CLI prints status updates that include path info; we don't
 * print fact text directly today, but the logger wrap is in place so that
 * future status messages (or user-supplied loggers receiving paths
 * containing creds) get redacted at the boundary.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateSqliteToLance } from "../../../src/internal/memory/migrate-sqlite-to-lance.js";

describe("migrate-sqlite-to-lance T1.4 — logger redaction", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-migrate-redact-"));
  });
  afterEach(() => {
    /* OS-level tmpdir cleanup */
  });

  it("logger output never echoes a sk-* token even when path contains one", async () => {
    // Simulate a path containing a credential-shaped substring. The path
    // is harmless (just a directory name) but the redactor still strips it
    // — exactly the property we want on a logger called with arbitrary text.
    const logs: string[] = [];
    await migrateSqliteToLance({
      cwd: join(cwd, "sk-abcdef0123456789ghijklmn"),
      dryRun: true,
      logger: (m) => logs.push(m),
    }).catch(() => {
      /* expected: source dir does not exist; the catch is irrelevant —
       * what matters is that logs captured prior to the throw are redacted. */
    });
    for (const line of logs) {
      expect(line).not.toContain("sk-abcdef0123456789ghijklmn");
    }
  });

  it("logger wrap is transparent for normal messages (no false-positive mangling)", async () => {
    const logs: string[] = [];
    await migrateSqliteToLance({
      cwd,
      dryRun: false,
      logger: (m) => logs.push(m),
    });
    // The "0 facts" message must come through intact.
    expect(logs.some((l) => /0 facts|nothing/i.test(l))).toBe(true);
  });
});
