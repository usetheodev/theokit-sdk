import { expect, it } from "vitest";
import { buildSeccompFilter } from "../src/sandbox/seccomp.js";

/*
 * #385 — `shell_exec` returned zero lines for `node --test`, and lost the PARENT process's stdout
 * whenever a command spawned a child.
 *
 * Measured cause, by ablation on the real wrapped command: the restricted-network seccomp filter.
 * With `--seccomp` the suite produced 0 lines; without it, 38. The env allowlist and every bwrap
 * flag were ruled out first — each was removed in turn and the output survived.
 *
 * Four of the denied syscalls take an ALREADY-OPEN fd rather than an address: `getsockname`,
 * `getpeername`, `setsockopt`, `getsockopt`. cBPF cannot dereference an fd, so it cannot know the
 * family behind one — which means those four denied AF_UNIX too, and AF_UNIX is exactly what libuv
 * uses for a child's IPC channel. The filter's own AF_UNIX exemption on `socket`/`socketpair` shows
 * that was never the intent.
 *
 * The parent's stdout went with it: killed mid-flight, its buffered pipe write never flushed, while
 * the child's bytes — already written to the inherited fd — survived. That is why the child's line
 * appeared and the parent's did not.
 *
 * The four cannot establish network access on their own. `connect`, `bind`, `listen`, `accept`,
 * `accept4`, `sendto`, `sendmmsg`, `recvmmsg` and `shutdown` stay denied, and `socket()` still
 * refuses every family but AF_UNIX — measured unchanged: `INET-EPERM` before and after.
 */

const JEQ_K = 0x15;
const CONNECT = 42,
  BIND = 49,
  LISTEN = 50,
  ACCEPT = 43,
  SENDTO = 44;
const GETSOCKNAME = 51,
  GETPEERNAME = 52,
  SETSOCKOPT = 54,
  GETSOCKOPT = 55;
const PTRACE = 101,
  IO_URING_SETUP = 425;

/** Syscall numbers this filter compares against — every `k` of a `JEQ` instruction. */
function comparedNumbers(filter: Buffer): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < filter.length; i += 8) {
    if (filter.readUInt16LE(i) === JEQ_K) out.add(filter.readUInt32LE(i + 4));
  }
  return out;
}

it("no longer denies the four syscalls that only touch an already-open fd", () => {
  const compared = comparedNumbers(buildSeccompFilter({ networkRestricted: true }));

  for (const nr of [GETSOCKNAME, GETPEERNAME, SETSOCKOPT, GETSOCKOPT]) {
    expect(
      compared.has(nr),
      `syscall ${nr} must not be denied — it cannot tell AF_UNIX apart`,
    ).toBe(false);
  }
});

it("still denies everything that could actually reach a network", () => {
  // The accepted case (`testing.md` § 4.2) and the reason this is a scalpel rather than a switch:
  // dropping the whole network set would restore the output AND let a confined command open a
  // connection. These take an address or change an fd's role, so denying them is family-blind in a
  // way that costs nothing — there is no AF_UNIX `listen` in a child's IPC path.
  const compared = comparedNumbers(buildSeccompFilter({ networkRestricted: true }));

  for (const nr of [CONNECT, BIND, LISTEN, ACCEPT, SENDTO]) {
    expect(compared.has(nr), `syscall ${nr} must stay denied`).toBe(true);
  }
});

it("keeps the network-independent hardening in both modes", () => {
  for (const networkRestricted of [true, false]) {
    const compared = comparedNumbers(buildSeccompFilter({ networkRestricted }));
    expect(compared.has(PTRACE)).toBe(true);
    expect(compared.has(IO_URING_SETUP)).toBe(true);
  }
});

it("adds no socket denial at all when the network is unrestricted", () => {
  const compared = comparedNumbers(buildSeccompFilter({ networkRestricted: false }));

  for (const nr of [CONNECT, BIND, LISTEN, ACCEPT, SENDTO]) {
    expect(compared.has(nr)).toBe(false);
  }
});
