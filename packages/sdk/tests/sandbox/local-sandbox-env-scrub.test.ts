import { afterEach, describe, expect, it } from "vitest";

import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";

/**
 * #54-c — end-to-end proof that `LocalSandbox.execute` actually scrubs secret-like
 * host env vars from the child (the wiring at `local-sandbox.ts` was previously
 * only covered indirectly by the `resolveChildEnv` unit test). Runs a REAL
 * subprocess and inspects its environment.
 */
describe("LocalSandbox env scrub (#54-c, e2e)", () => {
  const injected = ["THEOKIT_TEST_SECRET_KEY", "THEOKIT_TEST_DATABASE_URL", "THEOKIT_TEST_PLAIN"];
  afterEach(() => {
    for (const k of injected) delete process.env[k];
  });

  it("does not leak secret-like host env vars to the child, but keeps non-secret + PATH", async () => {
    process.env.THEOKIT_TEST_SECRET_KEY = "s3cr3t"; // *KEY* → dropped
    process.env.THEOKIT_TEST_DATABASE_URL = "postgres://u:pw@h/db"; // connection string → dropped; trufflehog:ignore (fixture, not a live credential)
    process.env.THEOKIT_TEST_PLAIN = "keepme"; // non-secret → kept

    const sandbox = new LocalSandbox({ workDir: "/tmp" });
    const result = await sandbox.execute("printenv");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("s3cr3t");
    expect(result.stdout).not.toContain("postgres://u:pw@h/db"); // trufflehog:ignore — fixture, not a live credential
    expect(result.stdout).not.toContain("THEOKIT_TEST_SECRET_KEY");
    expect(result.stdout).not.toContain("THEOKIT_TEST_DATABASE_URL");
    // Non-secret var and PATH survive.
    expect(result.stdout).toContain("THEOKIT_TEST_PLAIN=keepme");
    expect(result.stdout).toMatch(/^PATH=/m);
  });
});
