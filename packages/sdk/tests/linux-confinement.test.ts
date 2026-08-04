/**
 * M75 T2.1 — the pure kernel-confinement functions, promoted out of the agent-builder.
 *
 * ## Por que promover
 *
 * `buildBwrapArgv`, `detectBwrap` and `buildSeccompFilter` have nothing agent-builder-specific about them:
 * they are the infrastructure **every** theokit consumer that runs commands would reimplement. Measured
 * cost of the promotion: **zero dependencies** — only `node:child_process`, `node:fs` and
 * `node:path`; the cBPF filter is a `Buffer` built in pure JS, with no `seccompiler` and no native
 * binding.
 *
 * ## Why this file is RED before the code exists
 *
 * The modules do not exist yet. The import fails, and that is what proves the test measures the
 * promoted code — not a local reimplementation that would pass on its own.
 *
 * ## What this file does NOT replace
 *
 * Os 24 testes originais migraram em `tests/bwrap-argv.test.ts` (18) e `tests/seccomp-filter.test.ts`
 * (6), changing **only** `import` lines (D4 of the plan). This file is the promotion's RED, not the
 * parity suite — confusing the two would leave the migration without an oracle.
 *
 * CORRECTION (M75 review): this note **asserted something false** for a while. The 24 had been
 * deleted and replaced by the 9 here, and the review proved the cost by mutation — swapping
 * `buildSeccompFilter` for a filter that denies NOTHING passed 9/9. The 9 here test SHAPE (it is a
 * Buffer, it is deterministic); the SEMANTICS (which syscalls are denied, in what order, with what
 * guard) live in the 24 migrated ones.
 */
import { describe, expect, it } from "vitest";

import {
  type BwrapProbes,
  buildBwrapArgv,
  buildSeccompFilter,
  detectBwrap,
  resetBwrapMemo,
} from "../src/sandbox/index.js";

/** Injectable probes: no test in this file touches the host. */
const probesFalsos = (over: Partial<BwrapProbes> = {}): BwrapProbes => ({
  which: () => "/usr/bin/bwrap",
  helpText: () => "--perms\n--ro-bind\n--unshare-user",
  userns: () => true,
  ...over,
});

describe("M75 T2.1 — buildBwrapArgv promovido", () => {
  it("test_workspace_write_confina_fs_e_rede", () => {
    const argv = buildBwrapArgv("workspace-write", {
      cwd: "/w",
      network: false,
      env: {},
    });
    expect(argv, "workspace-write must produce argv, not null").not.toBeNull();
    const s = (argv ?? []).join(" ");
    // Whole disk read-only, cwd read-write, network out — the mode's three invariants.
    expect(s).toContain("--ro-bind / /");
    expect(s).toContain("--bind /w /w");
    expect(s).toContain("--unshare-net");
  });

  it("test_danger_full_access_does_not_wrap", () => {
    // `null` is the "do not wrap" contract — an explicit opt-out, not an anomaly. Returning an argv
    // an empty one would conflate "no confinement" with "confinement without flags".
    expect(buildBwrapArgv("danger-full-access", { cwd: "/w", network: true, env: {} })).toBeNull();
  });

  it("test_read_only_grants_no_write_even_on_the_cwd", () => {
    const s = (buildBwrapArgv("read-only", { cwd: "/w", network: false, env: {} }) ?? []).join(" ");
    expect(s).toContain("--ro-bind / /");
    expect(s, "read-only must not contain a --bind of the cwd").not.toContain("--bind /w /w");
  });
});

describe("M75 T2.1 — detectBwrap promovido", () => {
  it("test_it_detects_when_every_probe_passes", () => {
    expect(detectBwrap(probesFalsos())).toEqual({ ok: true, bin: "/usr/bin/bwrap" });
  });

  it("test_a_blocked_userns_is_an_honest_failure_with_a_reason", () => {
    // This is exactly the path the agent-builder's CI exercised: bubblewrap installed, userns
    // blocked by Ubuntu 24.04's AppArmor. The contract is to degrade with a REASON — never pretend.
    const d = detectBwrap(probesFalsos({ userns: () => false }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason, "the failure must say WHY").toMatch(/namespace/i);
  });

  it("test_a_null_which_is_an_honest_failure", () => {
    // O anti-hijack (recusar um `bwrap` que vive dentro do workspace) mora DENTRO de
    // `realProbes.which`, not in `detectBwrap` — injecting a fake probe would bypass it, and a test
    // that "verifies" it via an injected probe would be measuring its own fixture.
    //
    // CORRECTION (M75 review): an earlier version of this comment said the anti-hijack was
    // "covered by bwrap.test.ts's 18 tests". False both ways — those tests had
    // been deleted (they live in `tests/bwrap-argv.test.ts` today), and even the originals NEVER
    // covered it (`grep realProbes` in the original file: zero). The gap is PRE-EXISTING and still
    // open; claiming coverage that does not exist is worse than the gap, because it stops anyone
    // from looking. What is measured here is `detectBwrap`'s contract facing a `which` that did not
    // resolve.
    const d = detectBwrap(probesFalsos({ which: () => null }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toMatch(/PATH|found/i);
  });
});

describe("M75 T2.1 — buildSeccompFilter promovido", () => {
  it("test_gera_programa_cbpf_como_buffer_sem_dependencia_nativa", () => {
    const f = buildSeccompFilter({ networkRestricted: true });
    expect(Buffer.isBuffer(f)).toBe(true);
    // Each cBPF instruction takes 8 bytes; a valid program is a multiple of 8 and is not empty.
    expect(f.length).toBeGreaterThan(0);
    expect(f.length % 8, "a cBPF program must be a multiple of 8 bytes").toBe(0);
  });

  it("test_two_builds_with_the_same_input_are_byte_identical", () => {
    // Determinism is what allows writing the program ONCE per process and reusing the path.
    expect(
      buildSeccompFilter({ networkRestricted: true }).equals(
        buildSeccompFilter({ networkRestricted: true }),
      ),
    ).toBe(true);
  });
});

describe("M75 T2.1 — the detection memo", () => {
  it("test_memo_e_concurrent_test_com_atomic_counter_invariant", async () => {
    // Shared module state (`let memo`) is a concurrency signal. The invariant counts CAUSE — how
    // many real probes happened — and not wall-clock time: it does not flake under load.
    const { detectBwrapMemoized } = await import("../src/sandbox/index.js");
    resetBwrapMemo();
    // The counter has to be MINE: `realProbeCount()` only counts `realProbes` probes, and this test
    // does not touch the host. Counting the injected probe's calls is what actually measures the memo.
    let sondagens = 0;
    const contando = probesFalsos({
      which: () => {
        sondagens++;
        return "/usr/bin/bwrap";
      },
    });
    await Promise.all(Array.from({ length: 20 }, async () => detectBwrapMemoized(contando)));
    expect(
      sondagens,
      "20 concurrent calls probed more than once — the memo did not serialize",
    ).toBe(1);
  });
});
