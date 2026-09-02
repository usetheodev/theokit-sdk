/**
 * T1.3 — the MCP OAuth flow becomes reachable from the published package.
 *
 * ## The finding
 *
 * 286 tested lines of MCP PKCE + refresh live at `internal/mcp/oauth.ts`, and `internal/mcp` appears
 * in neither the `exports` map nor `tsup.config.ts`. So a customer building against a remote MCP
 * server that requires OAuth writes PKCE by hand — while the capability index tells them the
 * capability has *"no implementation"*, which prescribes the expensive fix for a problem whose real
 * shape is the cheap one: implemented, not published.
 *
 * ## Why a sanctioned barrel and not `./internal/mcp`
 *
 * There IS precedent for publishing `internal/*` subpaths (`./internal/persistence`,
 * `./internal/security`). Measured, that precedent is being RETIRED: `internal/persistence/index.ts`
 * carries `@deprecated SE43 DoD#2 — … import from the sanctioned public barrel
 * '@theokit/sdk/persistence' instead`. Adding a new one would extend a convention the package is
 * actively withdrawing, so this follows where it is going rather than where it has been.
 *
 * ## Why the export map and the build entry are asserted TOGETHER
 *
 * This is gap 25's exact failure shape — a subpath declared in `exports` that resolves to a file
 * `tsup` never builds. The import then fails at the consumer with ERR_MODULE_NOT_FOUND, which reads
 * like the consumer's mistake. Neither half is worth anything without the other, so neither is
 * asserted alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUBPATH = "./mcp-auth";
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
  exports: Record<string, { import?: { types?: string; default?: string } }>;
};
const tsup = readFileSync(join(__dirname, "..", "..", "tsup.config.ts"), "utf8");

describe("the MCP OAuth flow is reachable from the package", () => {
  it("test_the_subpath_is_declared_in_the_exports_map", () => {
    expect(
      Object.keys(pkg.exports),
      "a capability nobody can import is indistinguishable from one that does not exist",
    ).toContain(SUBPATH);
  });

  it("test_the_declared_subpath_has_a_matching_build_entry", () => {
    // Gap 25: `exports` pointing at a path `tsup` never emits. The import fails at the CONSUMER,
    // where it looks like their mistake.
    expect(pkg.exports[SUBPATH]?.import?.default).toBe("./dist/mcp-auth.js");
    // Both halves of the contract. The first draft asserted only the JS, and the build shipped a
    // subpath whose declared `types` pointed at a file `tsup` never emitted: the import worked and
    // the types silently did not, which is the same gap 25 shape wearing a quieter face. Entries
    // that reach into `internal/runtime` — this one does, via atomic-write and the retry predicate —
    // take the `tsc` DTS route (tsconfig.tools-dts.json), not `dts.entry`.
    expect(pkg.exports[SUBPATH]?.import?.types).toBe("./dist/mcp-auth.d.ts");
    const toolsDts = readFileSync(join(__dirname, "..", "..", "tsconfig.tools-dts.json"), "utf8");
    expect(
      toolsDts,
      "declared `types` with no DTS route — the subpath would import as `any` with no error",
    ).toContain("src/mcp-auth.ts");
    // The FOURTH hand-maintained list this one subpath has to appear in, after `exports`, the tsup
    // entry, and the tsc include. `require`'s `.d.cts` is produced by mirroring the `.d.ts`, from a
    // literal array in a script. Forget it and CommonJS consumers get no types, with no build error
    // — so the test names the list rather than trusting anyone to remember it.
    const mirror = readFileSync(
      join(__dirname, "..", "..", "scripts", "mirror-dts-to-cts.mjs"),
      "utf8",
    );
    expect(mirror, "the .d.cts mirror is a literal list; a missing entry fails silently").toContain(
      "mcp-auth.d.ts",
    );
    expect(
      tsup.includes('"mcp-auth": "src/mcp-auth.ts"') ||
        tsup.includes('"mcp-auth":"src/mcp-auth.ts"'),
      "declared in exports but absent from tsup.config.ts — the subpath would resolve to a file " +
        "that is never built",
    ).toBe(true);
  });

  it("test_the_barrel_exports_the_two_functions_the_capability_index_names", async () => {
    const barrel = (await import("../../src/mcp-auth.js")) as Record<string, unknown>;
    expect(typeof barrel.runPkceFlow, "runPkceFlow is the flow itself").toBe("function");
    expect(
      typeof barrel.refreshAccessToken,
      "without refresh the caller re-authorizes on every token expiry, which is the manual work " +
        "this subpath exists to remove",
    ).toBe("function");
  });

  it("test_the_barrel_also_exports_token_storage", async () => {
    // `runPkceFlow` returns tokens; a caller with nowhere to put them has half a capability, and
    // `token-storage.ts` sits in the same folder already solving it — including the locked refresh
    // that keeps two callers who notice the expiry at the same moment from both refreshing, which
    // loses the race under a rotating refresh token.
    const barrel = (await import("../../src/mcp-auth.js")) as Record<string, unknown>;
    for (const symbol of ["getTokens", "setTokens", "lockedRefresh"]) {
      expect(
        typeof barrel[symbol],
        `${symbol} belongs with the flow that produces the tokens`,
      ).toBe("function");
    }
  });

  it("test_the_barrel_does_not_export_the_test_only_reset_hook", async () => {
    // Asserted on the module's real exports, not on its source text — the first draft of this test
    // matched the word inside this file's own docblock and failed on a barrel that was correct.
    const barrel = (await import("../../src/mcp-auth.js")) as Record<string, unknown>;
    expect(
      Object.keys(barrel),
      "_resetForTests is module-state surgery for this repo's own tests; publishing it invites a " +
        "consumer to clear a cache the package is responsible for",
    ).not.toContain("_resetForTests");
  });
});
