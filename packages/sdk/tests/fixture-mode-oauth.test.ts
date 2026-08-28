import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isStoredOAuthAvailable,
  shouldUseRealLocalRuntime,
} from "../src/internal/runtime/fixtures/fixture-mode.js";

/**
 * #445 — a successful `/login` must not leave the consumer talking to the fixture responder.
 *
 * The regression is silent by nature: the agent answered "Done." with no error, so the failure
 * looked like a memory-recall bug for as long as anyone cared to chase it.
 */
describe("#445 — OAuth credential green-lights the real runtime", () => {
  let home: string;
  const saved = { ...process.env };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "theokit-auth-"));
    // THEOKIT_AUTH_HOME IS the store directory, not its parent: `credentialHome` returns the
    // override verbatim and only falls back to `<home>/<dirName>` when it is unset.
    await chmod(home, 0o700);
    process.env.THEOKIT_AUTH_HOME = home;
    // A logged-in consumer sets neither of these. That is the point.
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(async () => {
    process.env = { ...saved };
    await rm(home, { recursive: true, force: true });
  });

  const writeOAuth = async (): Promise<void> => {
    await writeFile(
      join(home, "auth.json"),
      JSON.stringify({
        type: "oauth",
        provider: "openai",
        access: "access-token-value",
        refresh: "refresh-token-value",
        expires: Date.now() + 3_600_000,
        account_id: "acct-1",
      }),
      { mode: 0o600 },
    );
  };

  it("reports no stored credential on an empty store", () => {
    expect(isStoredOAuthAvailable(process.env)).toBe(false);
  });

  it("detects a stored OAuth credential", async () => {
    await writeOAuth();
    expect(isStoredOAuthAvailable(process.env)).toBe(true);
  });

  it("runs the REAL runtime after login, with no apiKey and no provider env var", async () => {
    await writeOAuth();
    // Exactly the shape an `openai-chatgpt` consumer has: OAuth on disk, nothing else.
    expect(shouldUseRealLocalRuntime(undefined)).toBe(true);
  });

  it("still falls back to fixtures when nothing is logged in", () => {
    expect(shouldUseRealLocalRuntime(undefined)).toBe(false);
  });

  it("keeps an explicit fixture key authoritative over a stored credential", async () => {
    await writeOAuth();
    // A caller asking for fixtures gets fixtures, logged in or not — otherwise every test
    // suite on a developer machine with a credential would start making live calls.
    expect(shouldUseRealLocalRuntime("theo_test_whatever")).toBe(false);
  });
});
