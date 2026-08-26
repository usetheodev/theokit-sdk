// MIGRATED from the agent-builder in M75 T4.1 — SECOND attempt, and the reason is in the review.
//
// The first "migration" wrote NEW tests with injected probes and deleted these 24. The review
// proved by MUTATION what that cost: swapping buildSeccompFilter for `Buffer.alloc(8)` — a filter
// that denies NOTHING, no arch guard, no ptrace, no io_uring, no AF_INET — passed 9/9. The
// entire semantics of the cBPF filter was vacuous.
//
// Here the change is ONLY in the import block (D4). No body, no assertion.

import { describe, expect, it } from "vitest";

import { buildSeccompFilter } from "../src/sandbox/seccomp.js";

/**
 * M63 T0.1 — cBPF seccomp filter, byte-faithful to Codex `linux-sandbox/src/landlock.rs:179-216`.
 * Default ALLOW; deny → ERRNO(EPERM); KILL only on arch/x32 guard. socket-family via args[0].
 */

// decodes sock_filter (8 bytes LE) → {code,jt,jf,k}
function decode(buf: Buffer): { code: number; jt: number; jf: number; k: number }[] {
  const out = [];
  for (let i = 0; i < buf.length; i += 8) {
    // `readUInt8` instead of `buf[i+2]`: the SDK compiles with `noUncheckedIndexedAccess`, which types the
    // raw index as possibly undefined. This changes ACCESS, not the assertion — the value read is
    // the same byte, and D4 is still honored (no `expect` in this file changed).
    out.push({
      code: buf.readUInt16LE(i),
      jt: buf.readUInt8(i + 2),
      jf: buf.readUInt8(i + 3),
      k: buf.readUInt32LE(i + 4),
    });
  }
  return out;
}
// syscalls that appear as the k of a JEQ (BPF_JMP|BPF_JEQ|BPF_K = 0x15)
function jeqConstants(buf: Buffer): number[] {
  return decode(buf)
    .filter((f) => f.code === 0x15)
    .map((f) => f.k);
}

const EPERM_RET = 0x00050001;
const ALLOW_RET = 0x7fff0000;

describe("buildSeccompFilter", () => {
  it("buffer_is_multiple_of_8", () => {
    expect(buildSeccompFilter({ networkRestricted: false }).length % 8).toBe(0);
    expect(buildSeccompFilter({ networkRestricted: true }).length % 8).toBe(0);
  });

  it("always_denied_present_recvfrom_and_sendmsg_absent", () => {
    const ks = jeqConstants(buildSeccompFilter({ networkRestricted: true }));
    // always-denied (landlock.rs:179-184)
    for (const nr of [101, 310, 311, 425, 426, 427]) expect(ks).toContain(nr);
    // recvfrom(45) and sendmsg(46) NEVER denied (landlock.rs:198-201)
    expect(ks).not.toContain(45);
    expect(ks).not.toContain(46);
  });

  it("network_restricted_adds_socket_set", () => {
    const on = jeqConstants(buildSeccompFilter({ networkRestricted: true }));
    // #385 — `getsockname`(51), `getpeername`(52), `setsockopt`(54) and `getsockopt`(55) LEFT this
    // set, and this assertion changed with them. That is a deliberate divergence from
    // `landlock.rs`, not a loosened guarantee: those four take an already-open fd, cBPF cannot
    // dereference one to learn its family, so denying them denied AF_UNIX too — and killed every
    // command that spawned a child (`node --test` returned 0 lines; the parent's own stdout went
    // with it). They cannot reach a network on their own, and the measured guarantee is unchanged:
    // an AF_INET socket is still EPERM, an AF_UNIX socketpair still works. See
    // `seccomp-fd-syscalls.test.ts` for both halves.
    for (const nr of [42, 43, 288, 49, 50, 48, 44, 307, 299]) expect(on).toContain(nr);
    for (const nr of [51, 52, 54, 55]) expect(on).not.toContain(nr);
    const off = jeqConstants(buildSeccompFilter({ networkRestricted: false }));
    // without a restricted network, the socket set does NOT go in (but the always-denied ones do)
    for (const nr of [42, 49, 44]) expect(off).not.toContain(nr);
    expect(off).toContain(101); // ptrace always
  });

  it("socket_family_checks_args0_offset16", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: true }));
    // socket(41)/socketpair(53) present
    const ks = f.filter((x) => x.code === 0x15).map((x) => x.k);
    expect(ks).toContain(41);
    expect(ks).toContain(53);
    // there is an absolute LD of offset 16 (args[0] low dword): code BPF_LD|BPF_W|BPF_ABS=0x20, k=16
    expect(f.some((x) => x.code === 0x20 && x.k === 16)).toBe(true);
    // AF_UNIX(1) compared
    expect(ks).toContain(1);
  });

  it("arch_and_x32_guard_first", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: false }));
    // 1st instruction: LD arch@4
    expect(f[0]?.code).toBe(0x20);
    expect(f[0]?.k).toBe(4);
    // AUDIT_ARCH_X86_64 compared
    expect(f.some((x) => x.code === 0x15 && x.k === 0xc000003e)).toBe(true);
    // guard x32: JGE 0x40000000 (BPF_JMP|BPF_JGE|BPF_K = 0x35)
    expect(f.some((x) => x.code === 0x35 && x.k === 0x40000000)).toBe(true);
    // there is a RET KILL (0x80000000) in the guard
    expect(f.some((x) => x.code === 0x06 && x.k === 0x80000000)).toBe(true);
  });

  it("default_allow_last_and_deny_is_eperm", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: true }));
    // the fall-through (1st RET, after all denies) MUST be ALLOW — default allow
    const firstRet = f.find((x) => x.code === 0x06);
    expect(firstRet?.k).toBe(ALLOW_RET);
    // RET ERRNO(EPERM) and RET KILL both exist
    expect(f.some((x) => x.code === 0x06 && x.k === EPERM_RET)).toBe(true);
    expect(f.some((x) => x.code === 0x06 && x.k === 0x80000000)).toBe(true);
  });
});
