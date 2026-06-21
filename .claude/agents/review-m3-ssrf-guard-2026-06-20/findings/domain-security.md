---
agent: review-m3-ssrf-guard-domain-security
review_target: main..HEAD for plan m3-ssrf-guard
domain: security
verdict: SOUND_FOR_V1_WITH_ONE_MEDIUM
summary_counts:
  BLOCKER: 0
  HIGH: 0
  MEDIUM: 1
  LOW: 2
  INFO: 3
domain_specific_patterns_checked:
  - "cloud-metadata block (169.254.169.254 direct + DNS-resolved + IPv4-mapped)"
  - "alternate IPv4 encodings (decimal/octal/hex/short) normalization"
  - "IPv6 loopback/link-local/ULA + IPv4-mapped unwrap (compressed + expanded)"
  - "redirect re-screening (per-hop, non-http rejection, redirect chain)"
  - "TOCTOU / DNS-rebinding residual-window documentation (ADR D4)"
  - "0.0.0.0 routing block"
  - "fail-closed: non-IP host cannot reach fetch without resolveAndScreen"
---

# Domain Security Review — M3-1 SSRF guard

Adversarial probe of `packages/sdk-tools/src/internal/network-guard.ts` +
`packages/sdk-tools/src/web-fetch.ts`. Every claim below was verified empirically on
Node v22.22.2 (the repo's pinned runtime) by replicating the guard logic + exercising
`new URL().hostname`, `net.isIP`, and `node:dns` canonicalization.

## Bypass probe matrix (verified, not assumed)

| Vector | Via `web_fetch` / `screenedFetch` | Verdict |
|---|---|---|
| `http://169.254.169.254/` | `URL.hostname` = `169.254.169.254`, `isIP`=4, `isBlockedV4` (169.254/16) | **BLOCKED** (network-guard.ts:53,100) |
| metadata via DNS name → 169.254.169.254 | `resolveAndScreen` resolves all, screens each addr | **BLOCKED** (network-guard.ts:136-138) |
| `http://[::ffff:169.254.169.254]/` | normalizes to `[::ffff:a9fe:a9fe]`, hex-mapped regex unwraps → 169.254.169.254 | **BLOCKED** (network-guard.ts:70-74,102-103) |
| decimal `http://2130706433/` | `URL.hostname` itself canonicalizes → `127.0.0.1` (NOT DNS, as plan D5 claimed) | **BLOCKED** (network-guard.ts:100) |
| octal `http://0177.0.0.1/` | `URL.hostname` → `127.0.0.1` | **BLOCKED** |
| hex `http://0x7f.0.0.1/` | `URL.hostname` → `127.0.0.1` | **BLOCKED** |
| short `http://127.1/` | `URL.hostname` → `127.0.0.1` | **BLOCKED** |
| `http://[::1]/` | `isIP`=6, `isBlockedV6` `::1` | **BLOCKED** (network-guard.ts:81) |
| `http://[::ffff:7f00:1]/` (hex mapped) | hex-mapped regex → 127.0.0.1 | **BLOCKED** (network-guard.ts:70-74) |
| `http://[0:0:0:0:0:ffff:127.0.0.1]/` (expanded) | `URL.hostname` compresses → `[::ffff:7f00:1]` first, then regex unwraps | **BLOCKED via URL path** (see F-dom-1 for the non-URL path) |
| `http://[fe80::1]/` | `isBlockedV6` prefix `fe8` | **BLOCKED** (network-guard.ts:83) |
| `http://[fc00::1]/` / `http://[fd00::1]/` | `isBlockedV6` `fc`/`fd` | **BLOCKED** (network-guard.ts:90) |
| 302 → `http://169.254.169.254/` | per-hop `resolveAndScreen` on every hop before fetch | **BLOCKED** (network-guard.ts:187-188) |
| 302 → `file:///etc/passwd` | `redirectTarget` rejects non-http(s) protocol | **BLOCKED** (network-guard.ts:153-155) |
| chain public→public→private | loop re-screens each `current` before fetch | **BLOCKED** (network-guard.ts:186-194) |
| `http://0.0.0.0/` | `isBlockedV4` (0.0.0.0/8) | **BLOCKED** (network-guard.ts:50) |

The headline vectors are all blocked through the actual `web_fetch` / `screenedFetch`
path. The two normalization concerns the task raised resolve favorably **because
`new URL().hostname` does the canonicalization (decimal/octal/hex/short → dotted IPv4;
expanded IPv4-mapped → compressed `::ffff:` hex) BEFORE the host ever reaches the
guard** — the plan's D5 rationale attributed this to DNS, which is inaccurate (decimal
forms are URL-canonicalized, not DNS-resolved), but the outcome is the same: blocked.

## Findings

### F-dom-1 — MEDIUM — exported `isBlockedIp` misses expanded IPv4-mapped IPv6 (regex only matches compressed `::ffff:` form)

- **file:** `packages/sdk-tools/src/internal/network-guard.ts:66-77` (`ipv4Mapped`) + export at `packages/sdk-tools/src/index.ts:33`
- **plan_ref:** ADR D1 ("IPv4-mapped `::ffff:` → unwrap + re-check"), ADR D5 ("normalize before range-check")
- **domain_anchor:** SSRF block-list completeness for IPv4-mapped IPv6
- **detail:** `ipv4Mapped` only matches `^::ffff:(dotted)$` and `^::ffff:(hex):(hex)$`.
  The **expanded** form `0:0:0:0:0:ffff:127.0.0.1` (and `0:0:0:0:0:ffff:7f00:1`) is a
  valid IPv6 literal (`net.isIP` returns 6) but matches neither regex, so `ipv4Mapped`
  returns `undefined`, `isBlockedV6` returns `false`, and **`isBlockedIp("0:0:0:0:0:ffff:127.0.0.1")` returns `false`** (verified on Node 22).
  - **Reachability:** NOT exploitable through `web_fetch`/`screenedFetch`, because
    `new URL().hostname` compresses the expanded literal to `::ffff:7f00:1` before the
    guard sees it (verified). However, `isBlockedIp` is **exported as a public,
    documented reusable primitive** (index.ts:33; network-guard.ts:5-7 docstring calls
    it a "pure block-list ... for callers"). A second consumer that screens a raw IP
    string it did NOT route through `new URL()` (e.g., an address from a config file, a
    proxy `Forwarded`/`X-Forwarded-For` header, a gRPC peer, or a custom DNS resolver
    that emits expanded form) gets a **false negative** — `isBlockedIp` says "not
    blocked" for loopback. The `resolveAndScreen` DNS path also feeds raw resolver
    output (`a.address`, line 137) straight to `isBlockedIp` without URL normalization;
    Node's stock resolver returns dotted/compressed form so it's safe today, but the
    contract does not guarantee it, and an injected `lookup` (the DIP seam, line 109/133)
    returning expanded form would slip through.
  - This is precisely the gap the review brief flagged ("the regex only matches
    `::ffff:` compressed form"). Confirmed REAL for the exported primitive; MEDIUM (not
    HIGH/BLOCKER) only because the headline `web_fetch` path is shielded by URL
    normalization.
- **evidence:**
  ```
  isBlockedIp("0:0:0:0:0:ffff:127.0.0.1")  -> false   (isIP=6, mapped=undefined)
  isBlockedIp("::ffff:127.0.0.1")          -> true
  new URL("http://[0:0:0:0:0:ffff:127.0.0.1]/").hostname -> "[::ffff:7f00:1]"  (compressed → caught)
  ```
- **recommended_action:** Stop hand-rolling IPv4-mapped extraction by string regex.
  Either (a) canonicalize via `net` before classifying — e.g. detect the `::ffff:`
  mapping numerically over the 16 address bytes rather than by surface syntax; or (b)
  in `ipv4Mapped`, also match the expanded `^(0:){5}ffff:(...)$` form (both dotted and
  hex tails). Add unit cases: `isBlockedIp("0:0:0:0:0:ffff:127.0.0.1")`,
  `"0:0:0:0:0:ffff:7f00:1"`, uppercase, and a `resolveAndScreen` test with an injected
  `lookup` returning the expanded form.

### F-dom-2 — LOW — IPv4-embedded transition ranges (6to4 `2002::/16`, NAT64 `64:ff9b::/96`, deprecated IPv4-compatible `::a.b.c.d`) are not unwrapped

- **file:** `packages/sdk-tools/src/internal/network-guard.ts:79-91` (`isBlockedV6`)
- **plan_ref:** ADR D1 (IPv6 ranges enumerated: `::1`, `fe80::/10`, `fc00::/7`)
- **domain_anchor:** IPv6→IPv4 transition-mechanism SSRF vectors
- **detail:** `isBlockedV6` does not consider 6to4 (`2002:7f00:1::` embeds 127.0.0.1),
  NAT64 (`64:ff9b::7f00:1` embeds 127.0.0.1), or the deprecated IPv4-compatible
  (`::127.0.0.1` → `::7f00:1`) forms. Verified all three return `isBlockedIp=false`.
  Reachability through `web_fetch` requires the host actually route to the embedded
  private IPv4, which depends on local 6to4/NAT64 gateway config — uncommon on the
  server profiles this guard targets, hence LOW. The plan's enumerated v1 IPv6 scope
  (`::1`/`fe80::/10`/`fc00::/7`) does not claim to cover these, so this is a
  scope-completeness note, not a contract violation.
- **recommended_action:** Document these as known-deferred in the network-guard
  docstring (alongside the TOCTOU deferral), OR add them to `isBlockedV6` if any target
  environment runs 6to4/NAT64. Cheap to add: block `2002::/16`, `64:ff9b::/96`,
  `::/96` (IPv4-compatible) by the same prefix technique.

### F-dom-3 — LOW — `resolveAndScreen` DNS path trusts raw resolver string without re-normalizing

- **file:** `packages/sdk-tools/src/internal/network-guard.ts:136-138`
- **plan_ref:** ADR D5 (normalize before range-check)
- **detail:** Each `a.address` from `lookup` is passed directly to `isBlockedIp`. With
  Node's stock resolver this is fine (returns dotted IPv4 / canonical IPv6). But the
  guard's robustness is then conditional on resolver output format — coupled to
  F-dom-1: if a resolver (or the injected `lookup` test seam) returns an expanded
  IPv4-mapped string, it bypasses the block. Fixing F-dom-1 (numeric canonicalization)
  closes this transitively.
- **recommended_action:** Fold into the F-dom-1 fix (canonicalize numerically). No
  separate change needed if F-dom-1 is addressed at the byte level.

### F-dom-4 — INFO — TOCTOU / DNS-rebinding residual window is honestly documented and deferred (ADR D4)

- **file:** plan `m3-ssrf-guard-plan.md` ADR D4 (lines 86-89) + Drawbacks row (line 106);
  network-guard.ts:8 docstring notes screen-all + re-screen-hops.
- **detail:** The screen→fetch window (resolve+screen, then `fetch` re-resolves
  independently → rebinding) is **explicitly stated and accepted for v1**, with
  IP-pinning (undici `connect.lookup` dispatcher) named as the documented follow-up.
  This satisfies the brief's requirement that the residual window be "documented +
  accepted, not silently ignored." Honest deferral — no finding, recorded as a known
  limitation. Recommend the network-guard.ts module docstring also carry a one-line
  TOCTOU note so a reader of the code (not just the plan) sees it.

### F-dom-5 — INFO — fail-closed path confirmed: no non-IP host reaches fetch without screening

- **file:** `packages/sdk-tools/src/internal/network-guard.ts:122-140`, `186-194`;
  `web-fetch.ts:77-80, 115-129`
- **detail:** `isBlockedIp` returns `true` for any non-IP literal (line 106), and
  `resolveAndScreen` either returns screened IPs or throws. `screenedFetch` calls
  `resolveAndScreen(new URL(current).hostname)` on every hop **before** `fetchImpl`
  (line 187-190) unless `allowPrivateHosts`. A genuine DNS resolution failure
  (ENOTFOUND) rejects out of `resolveAndScreen` (non-Ssrf), propagates past the
  `instanceof SsrfBlockedError` check, and lands in `fetch_failed` (web-fetch.ts:124)
  — i.e. NO fetch occurs. Empty-resolution → `SsrfBlockedError("no addresses")` (line
  135). Verified the chain: `net.isIP` rejects all alternate encodings (returns 0) →
  they're treated as names → DNS-resolved → re-screened; the only reason they don't go
  to DNS in practice is `new URL()` canonicalizes them to literals first (also safe).
  No path found where a host skips screening. Fail-closed is sound.

### F-dom-6 — INFO — `allowPrivateHosts` opt-out is the only screening bypass and is correctly gated

- **file:** `web-fetch.ts:36, 79`; `network-guard.ts:187`
- **detail:** The single opt-out (`allowPrivateHosts:true`) defaults `false`
  (secure-by-default, ADR D2) and is the intended escape hatch for local-dev tooling.
  When set, `screenedFetch` skips `resolveAndScreen` entirely (line 187) but STILL uses
  `redirect:"manual"` + `redirectTarget` — note that with `allowPrivateHosts:true`,
  redirects are followed without host screening but non-http(s) redirect targets are
  still rejected (line 153-155). Acceptable: the opt-out is documented as "trusted
  local-dev" and the caller has explicitly disabled the guard. No finding.

## Verdict

The SSRF guard is **sound for the v1 scope** against every headline vector
(cloud-metadata in all three encodings, decimal/octal/hex/short IPv4, IPv6
loopback/link-local/ULA, compressed+expanded IPv4-mapped *through the `web_fetch`
path*, redirect-to-private, redirect-to-`file://`, redirect chains, `0.0.0.0`), with
TOCTOU IP-pinning honestly deferred (ADR D4). The one real defect is **F-dom-1
(MEDIUM)**: the exported `isBlockedIp` primitive returns a false negative for the
**expanded** IPv4-mapped IPv6 form (`0:0:0:0:0:ffff:127.0.0.1`) because the unwrap is
syntactic-regex rather than numeric — not exploitable via `web_fetch` (URL
normalization shields it) but unsafe for the second consumer the primitive is exported
to serve, and unsafe for any injected/non-stock resolver feeding the DNS path. Fix by
canonicalizing the IPv4-mapped check numerically over the address bytes; that single
change also closes F-dom-3 and makes F-dom-2 trivial to extend.
