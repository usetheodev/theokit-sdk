// MIGRADO do agent-builder no M75 T4.1 — SEGUNDA tentativa, e a razao esta no review.
//
// A primeira "migracao" escreveu testes NOVOS com probes injetados e deletou estes 24. O review
// provou por MUTACAO o que isso custou: trocar buildSeccompFilter por `Buffer.alloc(8)` — um filtro
// que nao nega NADA, sem arch guard, sem ptrace, sem io_uring, sem AF_INET — passava 9/9. A
// semantica inteira do filtro cBPF estava vacua.
//
// Aqui a mudanca e SO no bloco de import (D4). Nenhum corpo, nenhuma assercao.

import { describe, expect, it } from "vitest";

import { buildSeccompFilter } from "../src/sandbox/seccomp.js";

/**
 * M63 T0.1 — cBPF seccomp filter, byte-faithful to Codex `linux-sandbox/src/landlock.rs:179-216`.
 * Default ALLOW; deny → ERRNO(EPERM); KILL only on arch/x32 guard. socket-family via args[0].
 */

// decodifica sock_filter (8 bytes LE) → {code,jt,jf,k}
function decode(buf: Buffer): { code: number; jt: number; jf: number; k: number }[] {
  const out = [];
  for (let i = 0; i < buf.length; i += 8) {
    // `readUInt8` em vez de `buf[i+2]`: o SDK compila com `noUncheckedIndexedAccess`, que tipa o
    // índice cru como possivelmente indefinido. É mudança de ACESSO, não de asserção — o valor lido
    // é o mesmo byte, e D4 continua honrado (nenhum `expect` deste arquivo mudou).
    out.push({
      code: buf.readUInt16LE(i),
      jt: buf.readUInt8(i + 2),
      jf: buf.readUInt8(i + 3),
      k: buf.readUInt32LE(i + 4),
    });
  }
  return out;
}
// syscalls que aparecem como k de um JEQ (BPF_JMP|BPF_JEQ|BPF_K = 0x15)
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
    // sempre-negados (landlock.rs:179-184)
    for (const nr of [101, 310, 311, 425, 426, 427]) expect(ks).toContain(nr);
    // recvfrom(45) e sendmsg(46) NUNCA negados (landlock.rs:198-201)
    expect(ks).not.toContain(45);
    expect(ks).not.toContain(46);
  });

  it("network_restricted_adds_socket_set", () => {
    const on = jeqConstants(buildSeccompFilter({ networkRestricted: true }));
    for (const nr of [42, 43, 288, 49, 50, 52, 51, 48, 44, 307, 299, 55, 54])
      expect(on).toContain(nr);
    const off = jeqConstants(buildSeccompFilter({ networkRestricted: false }));
    // sem rede restrita, o set de socket NÃO entra (mas os sempre-negados sim)
    for (const nr of [42, 49, 44]) expect(off).not.toContain(nr);
    expect(off).toContain(101); // ptrace sempre
  });

  it("socket_family_checks_args0_offset16", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: true }));
    // socket(41)/socketpair(53) presentes
    const ks = f.filter((x) => x.code === 0x15).map((x) => x.k);
    expect(ks).toContain(41);
    expect(ks).toContain(53);
    // há um LD absoluto do offset 16 (args[0] low dword): code BPF_LD|BPF_W|BPF_ABS=0x20, k=16
    expect(f.some((x) => x.code === 0x20 && x.k === 16)).toBe(true);
    // AF_UNIX(1) comparado
    expect(ks).toContain(1);
  });

  it("arch_and_x32_guard_first", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: false }));
    // 1ª instrução: LD arch@4
    expect(f[0]?.code).toBe(0x20);
    expect(f[0]?.k).toBe(4);
    // AUDIT_ARCH_X86_64 comparado
    expect(f.some((x) => x.code === 0x15 && x.k === 0xc000003e)).toBe(true);
    // guard x32: JGE 0x40000000 (BPF_JMP|BPF_JGE|BPF_K = 0x35)
    expect(f.some((x) => x.code === 0x35 && x.k === 0x40000000)).toBe(true);
    // há RET KILL (0x80000000) no guard
    expect(f.some((x) => x.code === 0x06 && x.k === 0x80000000)).toBe(true);
  });

  it("default_allow_last_and_deny_is_eperm", () => {
    const f = decode(buildSeccompFilter({ networkRestricted: true }));
    // o fall-through (1º RET, após todos os denies) DEVE ser ALLOW — default allow
    const firstRet = f.find((x) => x.code === 0x06);
    expect(firstRet?.k).toBe(ALLOW_RET);
    // existem RET ERRNO(EPERM) e RET KILL
    expect(f.some((x) => x.code === 0x06 && x.k === EPERM_RET)).toBe(true);
    expect(f.some((x) => x.code === 0x06 && x.k === 0x80000000)).toBe(true);
  });
});
