/**
 * The MCP OAuth token store keeps a REFRESH TOKEN on disk, and it was protecting the file while
 * leaving the room it sits in unlocked.
 *
 * `setTokens` wrote through `atomicWriteJson`, whose parent-directory `mkdir` carries no mode, so
 * `~/.theokit` is born with whatever the umask allows — 0775 under the common 002. The subsequent
 * `chmod 600` on the file then buys nothing that matters: write permission on a DIRECTORY is
 * permission to unlink and recreate what is inside it, so another local user can replace the token
 * file wholesale. The read path had no mode check at all, unlike its credential sibling, so the
 * substitution would be picked up silently.
 *
 * The rule being enforced is not new and is deliberately not re-derived here: `assertSecureModes`
 * already states it, with the attack written next to it ("a writable dir lets an attacker replace
 * the credential file with a symlink to their own — the agent then runs on THEIR account"). A
 * refresh token is a credential by any reading, so it gets the same gate rather than a second
 * dialect of it.
 *
 * Third case: that gate was unconditional, and on Windows `statSync().mode` is synthetic (0666 for
 * a writable entry), so `mode & 0o022` is non-zero for every valid store and the gate refused all of
 * them. That is a pre-existing defect in the credential path — this suite pins the fix rather than
 * letting the new caller inherit it.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const POSIX = process.platform !== "win32";

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = join(tmpdir(), `theokit-mcp-tokens-${String(process.hrtime.bigint())}`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  process.env.HOME = home;
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Re-imported per test. It no longer has to be: since B-089 the store resolves its path on every
 * call, from `process.env.HOME` with `homedir()` as fallback, so a fresh module registry is not what
 * makes these tests correct. The dynamic import is kept because these tests also exercise the
 * module's first-load path, not because the path is bound there.
 */
async function loadStore() {
  return import("../src/internal/mcp/token-storage.js");
}

const TOKENS = {
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: Date.now() + 60_000,
  obtainedAt: Date.now(),
};

describe("MCP OAuth token store — the directory is part of the secret", () => {
  it.skipIf(!POSIX)("test_the_token_directory_is_created_private", async () => {
    const store = await loadStore();

    await store.setTokens("srv", TOKENS);

    const dir = join(home, ".theokit");
    expect(existsSync(dir), "the store directory must exist after a write").toBe(true);
    // 0o077 covers group AND other. Asserting "not group/other accessible" rather than "=== 0o700"
    // keeps the test about the property; a stricter real mode would still pass.
    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it.skipIf(!POSIX)("test_a_pre_existing_loose_directory_is_repaired_not_accepted", async () => {
    // `mkdir(mode)` applies only at CREATION, so a directory that already exists keeps whatever mode
    // it had. A machine that ran an older build already has ~/.theokit at 0775, and that is the
    // population this fix has to reach — otherwise it protects only fresh installs.
    const dir = join(home, ".theokit");
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o775);
    const store = await loadStore();

    await store.setTokens("srv", TOKENS);

    expect(statSync(dir).mode & 0o077).toBe(0);
  });

  it.skipIf(!POSIX)("test_a_group_writable_directory_is_refused_on_read", async () => {
    const store = await loadStore();
    await store.setTokens("srv", TOKENS);
    const dir = join(home, ".theokit");
    chmodSync(dir, 0o777);

    // Refused, not silently returned: the file inside a writable directory may have been swapped,
    // and returning it would hand the caller an attacker's refresh token as if it were the user's.
    await expect(store.getTokens("srv")).rejects.toThrow(/writable by other users/i);
  });

  it.skipIf(!POSIX)("test_a_correctly_permissioned_store_still_round_trips", async () => {
    // Anti-vacuity floor: a read path that always threw would satisfy the case above.
    const store = await loadStore();
    await store.setTokens("srv", TOKENS);

    await expect(store.getTokens("srv")).resolves.toMatchObject({ refreshToken: "rt" });
  });
});

describe("MCP OAuth token store — the store path follows the CURRENT home, not the one at import", () => {
  // B-089. The three tests above pass only because `vitest.config.ts` forces `fileParallelism:
  // false` + `maxConcurrency: 1`, so every file gets a fresh module registry and `loadStore()`
  // re-resolves the path. Under a shared registry (`--no-isolate`) they fail, because
  // `token-storage.ts` bound `join(homedir(), ...)` into a module constant AT IMPORT.
  //
  // This test pins the property directly and under the DEFAULT configuration: it imports the
  // module ONCE, then moves HOME, with NO `vi.resetModules()` in between. If the path is captured
  // at import, the write lands under the old home and the assertion fails. That is the whole
  // defect, expressed without depending on how the runner is configured — which is what makes the
  // fix observable to a gate that always runs serially.
  it.skipIf(!POSIX)("test_the_store_path_follows_a_later_HOME_change", async () => {
    const store = await loadStore();
    await store.setTokens("srv", TOKENS);

    const laterHome = join(tmpdir(), `theokit-mcp-tokens-later-${String(process.hrtime.bigint())}`);
    mkdirSync(laterHome, { recursive: true, mode: 0o700 });
    process.env.HOME = laterHome;

    try {
      await store.setTokens("srv2", TOKENS);

      expect(
        existsSync(join(laterHome, ".theokit", "mcp-tokens.json")),
        "a write after HOME moved must land under the CURRENT home",
      ).toBe(true);
    } finally {
      process.env.HOME = home;
      rmSync(laterHome, { recursive: true, force: true });
    }
  });
});

describe("MCP OAuth token store — the environment wins over os.homedir()", () => {
  // B-089, second review (HIGH-A). The test above pins that the path is not frozen at import, but it
  // passes with a `homedir()`-only resolver too — so it does not protect the decision D1 actually
  // made, which is that the ENVIRONMENT is the source of truth. That distinction is invisible on
  // POSIX in a normal process, because `os.homedir()` already prefers `$HOME`, and it is exactly
  // what breaks inside a worker thread where `process.env` is a JS copy and `homedir()` is a native
  // read.
  //
  // Forcing `homedir()` to a DECOY makes the precedence observable under the repo's own pool, which
  // is the only pool CI runs. Without this, the entire env-first change ships with no gate able to
  // fail on its removal.
  it.skipIf(!POSIX)("test_the_store_follows_the_env_even_when_homedir_disagrees", async () => {
    const decoy = join(tmpdir(), `theokit-mcp-decoy-${String(process.hrtime.bigint())}`);
    mkdirSync(decoy, { recursive: true, mode: 0o700 });
    vi.doMock("node:os", async () => {
      const actual = await vi.importActual<typeof import("node:os")>("node:os");
      return { ...actual, homedir: () => decoy };
    });

    try {
      vi.resetModules();
      const store = await loadStore();
      await store.setTokens("srv", TOKENS);

      expect(
        existsSync(join(home, ".theokit", "mcp-tokens.json")),
        "the write must follow process.env.HOME",
      ).toBe(true);
      expect(
        existsSync(join(decoy, ".theokit", "mcp-tokens.json")),
        "the write must NOT follow os.homedir() when the environment says otherwise",
      ).toBe(false);
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});

describe("assertSecureModes — a platform without POSIX modes is not an insecure platform", () => {
  it("test_the_gate_does_not_refuse_every_store_on_win32", async () => {
    // On Windows `statSync().mode` is synthetic: 0666 for a writable entry regardless of ACLs. The
    // unconditional gate therefore computed `0o666 & 0o022 !== 0` and refused EVERY store, valid or
    // not — so on that platform the credential path could not be read at all. Silence about ACLs is
    // the honest answer here; a mode check that cannot see them must not pretend to have run.
    const dir = join(home, "store");
    const file = join(dir, "creds.json");
    mkdirSync(dir, { recursive: true, mode: 0o777 });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, "{}", { mode: 0o666 });

    const { assertSecureModes } = await import("../src/auth/index.js");
    // Sanity: on POSIX this same input IS refused, which is what makes the win32 case a platform
    // decision rather than the gate being toothless.
    if (POSIX) {
      expect(() => {
        assertSecureModes(dir, file);
      }).toThrow();
    }

    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(() => {
      assertSecureModes(dir, file);
    }).not.toThrow();
  });
});
