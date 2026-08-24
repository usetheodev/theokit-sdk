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
 *
 * B-089 added a fourth concern to this file, and it is about WHERE the store looks rather than about
 * permissions. `token-storage.ts` used to bind its path into a module-level constant at import, so
 * the three permission cases above passed only because `vitest.config.ts` forces `fileParallelism:
 * false` and hands every file a fresh module registry. The path is now resolved per operation, from
 * the environment (`USERPROFILE` on win32, `HOME` elsewhere) with `homedir()` as fallback, and two
 * tests pin that: one proves the environment beats `homedir()`, the other proves the platform branch
 * reads the right variable. Both could have been written to pass vacuously, so both were
 * verified to FAIL against a reverted source rather than merely to pass against the current one.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // B-090 — `vitest.setup.ts` points `THEOKIT_HOME` at a per-test tmpdir for EVERY test in this
  // package, and since B-090 that variable WINS over the home. The cases below pin the
  // home-anchored FALLBACK, so the absence of the override is part of their arrange and has to be
  // stated rather than inherited from a setup file. `vitest.setup.ts`'s own `afterEach` restores
  // the original value unconditionally, so this delete cannot leak into a sibling test.
  delete process.env.THEOKIT_HOME;
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
 * call, from the environment (`USERPROFILE` on win32, `HOME` elsewhere) with `homedir()` as fallback, so a fresh module registry is not what
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

describe("MCP OAuth token store — the environment variable read is per platform", () => {
  // B-089, third review (HIGH-1). The test above pins that the ENVIRONMENT beats `homedir()`, but it
  // runs on POSIX and therefore only exercises the HOME leg of the ternary. Flipping `"win32"` to
  // `"darwin"` in the resolver, or swapping the two branches, left the whole suite green — which is
  // the same "shipped behaviour with no gate able to fail on its removal" defect the test above was
  // written to close, one commit later.
  //
  // The OS genuinely cannot be tested here (chmod semantics, libuv's USERPROFILE lookup) and the
  // source says so. The BRANCH SELECTION can: `process.platform` is spy-able, and this file already
  // uses that technique for the win32 mode gate below.
  it("test_the_store_reads_USERPROFILE_and_not_HOME_on_win32", async () => {
    const profile = join(tmpdir(), `theokit-mcp-profile-${String(process.hrtime.bigint())}`);
    const decoy = join(tmpdir(), `theokit-mcp-decoy-${String(process.hrtime.bigint())}`);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    mkdirSync(decoy, { recursive: true, mode: 0o700 });
    const originalProfile = process.env.USERPROFILE;

    try {
      // Inside the try on purpose: if the spy or the mock threw, a setup done above it would leave
      // USERPROFILE pointing at a deleted tmpdir for every later test in this worker. `afterEach`
      // restores HOME, not this.
      process.env.USERPROFILE = profile;
      vi.spyOn(process, "platform", "get").mockReturnValue("win32");
      vi.doMock("node:os", async () => {
        const actual = await vi.importActual<typeof import("node:os")>("node:os");
        return { ...actual, homedir: () => decoy };
      });

      vi.resetModules();
      const store = await loadStore();
      await store.setTokens("srv", TOKENS);

      expect(
        existsSync(join(profile, ".theokit", "mcp-tokens.json")),
        "on win32 the store must follow USERPROFILE, which is what os.homedir() reads there",
      ).toBe(true);
      expect(
        existsSync(join(home, ".theokit", "mcp-tokens.json")),
        "on win32 the store must NOT follow HOME — Git Bash sets it to a POSIX-shaped path",
      ).toBe(false);
      expect(
        existsSync(join(decoy, ".theokit", "mcp-tokens.json")),
        "the environment must still beat os.homedir() on win32",
      ).toBe(false);
    } finally {
      vi.doUnmock("node:os");
      vi.resetModules();
      if (originalProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalProfile;
      rmSync(profile, { recursive: true, force: true });
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

    const { assertSecureModes, CredentialError } = await import("../src/auth/index.js");
    // Sanity: on POSIX this same input IS refused, which is what makes the win32 case a platform
    // decision rather than the gate being toothless.
    if (POSIX) {
      // B-079 — was bare `.toThrow()`. `assertSecureModes` throws `CredentialError`
      // (src/internal/auth/credential-store.ts); that throw site sets no explicit
      // `.code`, so a class assertion is the strongest typed check available here.
      // `CredentialError` MUST come from this SAME dynamic `import()` — the module
      // was `vi.resetModules()`-ed in `beforeEach`, so a statically-imported class
      // reference is a different identity and `toThrow(Class)` fails on `instanceof`.
      expect(() => {
        assertSecureModes(dir, file);
      }).toThrow(CredentialError);
    }

    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    expect(() => {
      assertSecureModes(dir, file);
    }).not.toThrow();
  });
});

/**
 * B-090 — the store used to ignore `THEOKIT_HOME`, which is the variable this repo isolates tests
 * with. The consequence was not theoretical and not confined to tests: `vitest.setup.ts:74` backs
 * up `process.env.HOME` and never sets it, isolating only `THEOKIT_HOME` — so a home-anchored
 * module that ignored that variable resolved to the developer's real `~`. A default-config run of
 * this package deposited four refresh-token entries (`test-srv`, `srv-2`, `srv-race`,
 * `srv-roundtrip`) into the real `~/.theokit/mcp-tokens.json`, written by
 * `tests/golden/mcp/oauth.golden.test.ts`. A suite that believes it is isolated and is not is a
 * false green about isolation itself, which is worse than a red.
 *
 * The resolver adopted is `transcriptRoot()`'s, not `paths.ts`'s `getTheokitHome(cwd)`: the
 * transcript solves the identical problem for identically-shaped state — home-anchored default with
 * a `THEOKIT_HOME` override, trimmed, empty-guarded — and its docstring records that before M94 it
 * ignored the variable and "whoever set it had their state split in two silently", which is exactly
 * this defect. `getTheokitHome(cwd)` falls back to `<cwd>/.theokit`, and adopting it would move the
 * token file of everyone who does NOT set the variable — a migration nobody asked for, on a
 * credential.
 *
 * Both halves are pinned, per `rules/testing.md § 4.2`: the override case (the store follows it)
 * AND the fallthrough cases (empty / whitespace-only leave the home default in place). A resolver
 * tested only on the override cannot tell a correct precedence from one that always takes the env
 * branch, including when the value is unusable.
 */
describe("MCP OAuth token store — THEOKIT_HOME is the isolation variable (B-090)", () => {
  it("test_THEOKIT_HOME_redirects_the_token_file_away_from_the_home_default", async () => {
    const isolated = join(home, "isolated-state");
    process.env.THEOKIT_HOME = isolated;
    const store = await loadStore();

    await store.setTokens("srv-isolated", TOKENS);

    expect(
      existsSync(join(isolated, "mcp-tokens.json")),
      "the store must write under THEOKIT_HOME when it is set",
    ).toBe(true);
    expect(
      existsSync(join(home, ".theokit", "mcp-tokens.json")),
      "a test that sets THEOKIT_HOME must not deposit a refresh token in the real home",
    ).toBe(false);
  });

  it("test_THEOKIT_HOME_is_also_where_the_read_path_looks", async () => {
    // The store is NOT used to create this file. A roundtrip through `setTokens` would pass
    // whatever path the module picked, correct or not — it only proves the two halves agree with
    // each other. Placing the file by hand at the location the override names is what makes the
    // read path answerable.
    const isolated = join(home, "isolated-read");
    mkdirSync(isolated, { recursive: true, mode: 0o700 });
    const file = join(isolated, "mcp-tokens.json");
    writeFileSync(file, JSON.stringify({ "srv-read": TOKENS }), { mode: 0o600 });
    chmodSync(file, 0o600);
    process.env.THEOKIT_HOME = isolated;

    const store = await loadStore();

    await expect(store.getTokens("srv-read")).resolves.toEqual(TOKENS);
  });

  it("test_the_keytar_fallback_warning_names_the_resolved_store_path", async () => {
    // The warning used to spell `~/.theokit/mcp-tokens.json` as a literal. Once THEOKIT_HOME wins,
    // that literal sends anyone who sets the variable to look at a file the store no longer writes.
    // A diagnostic that names the wrong location is worse than one that names none, because the
    // reader stops looking after they find it empty.
    const isolated = join(home, "isolated-diag");
    process.env.THEOKIT_HOME = isolated;
    const store = await loadStore();
    store._resetForTests(); // clear the once-only warned flag left by a sibling test

    const emitted: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
      emitted.push(String(chunk));
      return true;
    });

    await store.setTokens("srv-diag", TOKENS);

    const warning = emitted.find((line) => line.includes("keytar not installed"));
    expect(warning, "the keytar-absent fallback must warn").toBeDefined();
    expect(warning, "the warning must name the store path actually in use").toContain(
      join(isolated, "mcp-tokens.json"),
    );
  });

  /**
   * N2 — the fix reached further than the path. `ensurePrivateStoreDir` chmods the store directory
   * 0700 UNCONDITIONALLY, and before B-090 that directory was always `~/.theokit`. Once
   * `THEOKIT_HOME` wins it is the operator's root, shared with sessions, transcripts, personality and
   * the credential pool — and `paths.ts:5-7` names "multi-tenant deployments" as a use case for the
   * variable. No other consumer of it imposes a mode. Silently demoting someone's 0775 root to 0700
   * is changing a permission we were never asked to manage.
   *
   * The retro-fix keeps its population (`<home>/.theokit`, see the sibling test above) and loses the
   * one it never had.
   */
  it.skipIf(!POSIX)(
    "test_a_pre_existing_THEOKIT_HOME_is_not_re_permissioned_by_a_write",
    async () => {
      const isolated = join(home, "operator-root");
      mkdirSync(isolated, { recursive: true });
      chmodSync(isolated, 0o775); // explicit: `mkdir`'s mode argument is masked by the umask
      process.env.THEOKIT_HOME = isolated;
      const store = await loadStore();

      await store.setTokens("srv-mode", TOKENS);

      expect(
        (statSync(isolated).mode & 0o777).toString(8),
        "a THEOKIT_HOME root we did not create must keep the mode its operator chose",
      ).toBe("775");
    },
  );

  // The other half (§ 4.2): declining to re-permission an existing root must not become declining to
  // protect one we create. A directory born from our own `mkdir` is ours, wherever it points.
  it.skipIf(!POSIX)("test_a_THEOKIT_HOME_we_create_ourselves_is_born_private", async () => {
    const isolated = join(home, "created-by-us");
    process.env.THEOKIT_HOME = isolated;
    const store = await loadStore();

    await store.setTokens("srv-new", TOKENS);

    expect(
      statSync(isolated).mode & 0o077,
      "a store directory we create must never be group- or world-accessible",
    ).toBe(0);
  });

  /**
   * The consequence of NOT repairing the operator's root, asserted rather than left to be discovered
   * in production. `assertSecureModes` sits outside `getTokens`'s catch on purpose: a refresh token
   * in a directory any local user can replace files in may already have been swapped, and returning
   * it would hand the caller an attacker's credential. Refusing loudly, with the `chmod 700` remedy
   * in the message, is the only outcome that neither mutates someone else's directory nor lies about
   * what it read.
   */
  it.skipIf(!POSIX)(
    "test_a_group_writable_THEOKIT_HOME_is_refused_on_read_rather_than_silently_repaired",
    async () => {
      const isolated = join(home, "loose-root");
      mkdirSync(isolated, { recursive: true });
      chmodSync(isolated, 0o777);
      process.env.THEOKIT_HOME = isolated;
      const store = await loadStore();
      await store.setTokens("srv-loose", TOKENS);

      await expect(store.getTokens("srv-loose")).rejects.toThrow(/writable by other users/i);
    },
  );

  // The accepted-input half of the guard (§ 4.2). Without these, a resolver that took the env
  // branch for ANY value — including one it cannot use — passes the override test above and
  // resolves the store to a CWD-relative `mcp-tokens.json`, or to a whitespace-named directory.
  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("test_an_unusable_THEOKIT_HOME_falls_through_to_the_home_anchored_default_%s", async (_label, value) => {
    process.env.THEOKIT_HOME = value;
    const store = await loadStore();

    await store.setTokens("srv-fallback", TOKENS);

    expect(
      existsSync(join(home, ".theokit", "mcp-tokens.json")),
      "an unusable THEOKIT_HOME must leave the home-anchored default in place",
    ).toBe(true);
  });
});
