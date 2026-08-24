// Promoted from agent-builder in M75 (plan m75-sandbox-kernel-no-framework, D1): confinement with
// kernel confinement is framework infrastructure, not the consumer's. Measured cost of the promotion: ZERO
// no dependencies — only node:child_process, node:fs and node:path. The cBPF filter is a Buffer in pure JS.

/**
 * M63 — cBPF seccomp filter generator. Produces a raw `sock_filter[]` program (the exact
 * shape `bwrap --seccomp <fd>` consumes) so syscall confinement needs no
 * native helper — bwrap applies `PR_SET_NO_NEW_PRIVS` + the filter before `execve`.
 *
 * Semantics (landlock.rs:252-253): default action = ALLOW; per-syscall match = ERRNO(EPERM). KILL is
 * used ONLY by the architecture/x32 guard. x86_64 only in v1 (aarch64 is a documented delta).
 */

// BPF opcodes (linux/bpf_common.h)
const BPF_LD = 0x00;
const BPF_W = 0x00;
const BPF_ABS = 0x20;
const BPF_JMP = 0x05;
const BPF_JEQ = 0x10;
const BPF_JGE = 0x30;
const BPF_K = 0x00;
const BPF_RET = 0x06;

const LD_ABS_W = BPF_LD | BPF_W | BPF_ABS; // 0x20
const JEQ_K = BPF_JMP | BPF_JEQ | BPF_K; // 0x15
const JGE_K = BPF_JMP | BPF_JGE | BPF_K; // 0x35
const RET_K = BPF_RET | BPF_K; // 0x06

// seccomp_data offsets (little-endian): nr@0, arch@4, args[0] low dword @16
const OFF_NR = 0;
const OFF_ARCH = 4;
const OFF_ARG0 = 16;

const AUDIT_ARCH_X86_64 = 0xc000003e;
const X32_BIT = 0x40000000; // nr >= this ⇒ x32 ABI ⇒ reject

// seccomp return actions (linux/seccomp.h)
const SECCOMP_RET_ALLOW = 0x7fff0000;
const SECCOMP_RET_ERRNO = 0x00050000;
const EPERM = 1;
const RET_EPERM = SECCOMP_RET_ERRNO | (EPERM & 0xffff); // 0x00050001
const SECCOMP_RET_KILL_PROCESS = 0x80000000;

const AF_UNIX = 1;

/** Always-denied, network-independent (landlock.rs:179-184). */
const ALWAYS_DENIED = [101, 310, 311, 425, 426, 427]; // ptrace, process_vm_readv/writev, io_uring_setup/enter/register
/** Denied only when the network is restricted (landlock.rs:188-204). recvfrom(45)/sendmsg(46) are NOT here. */
const NETWORK_DENIED = [42, 43, 288, 49, 50, 52, 51, 48, 44, 307, 299, 55, 54];
/** socket(2) / socketpair(2) — conditional on domain != AF_UNIX (landlock.rs:206-216). */
const SOCKET_SYSCALLS = [41, 53];

/** One `sock_filter` instruction: `{u16 code, u8 jt, u8 jf, u32 k}`. */
interface Insn {
  code: number;
  jt: number;
  jf: number;
  k: number;
}
const stmt = (code: number, k: number): Insn => ({ code, jt: 0, jf: 0, k });
const jmp = (code: number, k: number, jt: number, jf: number): Insn => ({ code, jt, jf, k });

/**
 * Input to {@link buildSeccompFilter} — the one axis the generated cBPF program varies on.
 *
 * `networkRestricted: true` adds the socket-family denials on top of the always-denied syscall set;
 * `false` emits the base program, which is NOT "no filter". The always-denied set applies either way.
 */
export interface SeccompOptions {
  /** When true (network off), also deny the socket set + non-AF_UNIX socket(). */
  networkRestricted: boolean;
}

/**
 * Build the cBPF seccomp program as a `Buffer` (each `sock_filter` = 8 bytes). Jump targets are
 * expressed against labels and back-patched to relative offsets, so the layout is deterministic and
 * unit-testable against the authoritative syscall list.
 */
export function buildSeccompFilter(opts: SeccompOptions): Buffer {
  // We assemble with symbolic targets, then resolve to relative jumps. To keep the classic
  // "deny → jump to a single DENY return; else fall through" shape, DENY and ALLOW live at the END and
  // every JEQ jumps FORWARD to them. jt/jf carry the DISTANCE (in instructions) to the target.
  const insns: Insn[] = [];

  // Placeholder labels resolved after we know total length.
  // Layout: [arch guard][x32 guard][LD nr][deny checks...][socket checks...][ALLOW][DENY][KILL]
  // We build the body first with jumps to ALLOW/DENY/KILL as sentinel indices, then patch.
  const ALLOW = Symbol("ALLOW");
  const DENY = Symbol("DENY");
  const KILL = Symbol("KILL");
  type Target = typeof ALLOW | typeof DENY | typeof KILL | number;
  interface SInsn {
    code: number;
    k: number;
    jt: Target;
    jf: Target;
  }
  const body: SInsn[] = [];
  const push = (code: number, k: number, jt: Target = 0, jf: Target = 0): void => {
    body.push({ code, k, jt, jf });
  };

  // --- arch guard: arch == x86_64 ? continue : KILL ---
  push(LD_ABS_W, OFF_ARCH);
  push(JEQ_K, AUDIT_ARCH_X86_64, 0, KILL); // if !=  → KILL
  // --- x32 guard: nr >= 0x40000000 ? KILL : continue ---
  push(LD_ABS_W, OFF_NR);
  push(JGE_K, X32_BIT, KILL, 0); // if >= → KILL
  // nr already loaded; keep it loaded for the deny checks.

  // --- unconditional denials → DENY ---
  const denied = opts.networkRestricted
    ? [...ALWAYS_DENIED, ...NETWORK_DENIED]
    : [...ALWAYS_DENIED];
  for (const nr of denied) push(JEQ_K, nr, DENY, 0); // if nr == syscall → DENY

  // --- socket-family: socket(41)/socketpair(53) → allow only AF_UNIX (only when restricted) ---
  if (opts.networkRestricted) {
    for (const sysno of SOCKET_SYSCALLS) {
      // if nr == socket → check domain; else skip the 2 domain-check instructions
      push(JEQ_K, sysno, 0, 2); // match: fall through to the LD/JEQ; no-match: jump +2 (past them)
      push(LD_ABS_W, OFF_ARG0); // load domain (args[0] low dword)
      push(JEQ_K, AF_UNIX, ALLOW, DENY); // AF_UNIX → ALLOW, else DENY
      // NOTE: after these, nr is NO LONGER in the accumulator — but every remaining syscall check
      // reloads via a fresh LD? No: the remaining path is only ALLOW. socket checks are LAST before
      // the tail, so a fall-through (non-socket syscall that reached here) goes straight to ALLOW.
    }
  }

  // --- tail ---
  push(RET_K, SECCOMP_RET_ALLOW); // ALLOW label target
  const allowIdx = body.length - 1;
  push(RET_K, RET_EPERM); // DENY
  const denyIdx = body.length - 1;
  push(RET_K, SECCOMP_RET_KILL_PROCESS); // KILL
  const killIdx = body.length - 1;

  // --- resolve symbolic targets to relative offsets ---
  // The branching IS the cBPF program: ALLOW/DENY/KILL are symbolic targets resolved to an
  // offset RELATIVE to the next instruction. Breaking it into helpers does not reduce real complexity —
  // it moves the jump arithmetic to another file and makes auditing against landlock.rs harder, the
  // the authoritative source.
  //
  // Not refactoring NOW is an M75 process decision: this function is being MIGRATED without behavior
  // change (plan m75, D4) and there is still no byte-for-byte equivalence oracle against the
  // original version. Refactoring security without that oracle is changing the lock in the dark.
  // Revisit when the parity gate (T4.2) is green — the oracle exists then.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
  const resolve = (i: number, t: Target): number => {
    const abs = t === ALLOW ? allowIdx : t === DENY ? denyIdx : t === KILL ? killIdx : i + 1 + t;
    // BPF jump offset is relative to the NEXT instruction: target - (i + 1)
    const off = abs - (i + 1);
    if (off < 0 || off > 255) throw new RangeError(`seccomp jump out of range at ${i}: ${off}`);
    return off;
  };
  // `for...of` over entries instead of a raw index: the SDK compiles with `noUncheckedIndexedAccess`, which
  // (correctly) types `body[i]` as possibly undefined. Iterating gives the guarantee in the type instead
  // requiring a `!` — the code already could not leave the range, and now the compiler knows it.
  for (const [i, b] of body.entries()) {
    if (b.code === JEQ_K || b.code === JGE_K) {
      insns.push(jmp(b.code, b.k, resolve(i, b.jt), resolve(i, b.jf)));
    } else {
      insns.push(stmt(b.code, b.k));
    }
  }

  const buf = Buffer.alloc(insns.length * 8);
  insns.forEach((ins, i) => {
    buf.writeUInt16LE(ins.code, i * 8);
    buf.writeUInt8(ins.jt, i * 8 + 2);
    buf.writeUInt8(ins.jf, i * 8 + 3);
    buf.writeUInt32LE(ins.k >>> 0, i * 8 + 4);
  });
  return buf;
}
