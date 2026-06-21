import { describe, expect, it } from "vitest";

import {
  isBlockedIp,
  resolveAndScreen,
  SsrfBlockedError,
  screenedFetch,
} from "../src/internal/network-guard.js";

/**
 * M3-1 — SSRF guard. Design: blueprint m3-ssrf-guard ADRs D1-D6.
 * isBlockedIp is pure; resolveAndScreen + screenedFetch take injectable
 * lookup/fetchImpl → deterministic tests without real DNS/network.
 */

describe("isBlockedIp (M3-1)", () => {
  it("test_isBlockedIp_loopback_v4", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("127.255.255.255")).toBe(true);
  });
  it("test_isBlockedIp_private_v4", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });
  it("test_isBlockedIp_link_local_and_metadata", () => {
    expect(isBlockedIp("169.254.1.1")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
  });
  it("test_isBlockedIp_cgnat", () => {
    expect(isBlockedIp("100.64.0.1")).toBe(true);
  });
  it("test_isBlockedIp_zero_and_reserved", () => {
    for (const ip of ["0.0.0.0", "224.0.0.1", "240.0.0.1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });
  it("test_isBlockedIp_public_v4_allowed", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
  });
  it("test_isBlockedIp_v6_loopback_linklocal_ula", () => {
    for (const ip of ["::1", "fe80::1", "fc00::1"]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });
  it("test_isBlockedIp_v6_public_allowed", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });
  it("test_isBlockedIp_ipv4_mapped_unwraps", () => {
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
  it("test_isBlockedIp_172_15_and_172_32_allowed", () => {
    expect(isBlockedIp("172.15.0.1")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
  });
  it("test_isBlockedIp_non_ip_returns_true", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
  });
  it("test_isBlockedIp_expanded_ipv4_mapped_blocked", () => {
    // review F-dom-1: the EXPANDED IPv4-mapped form must also block.
    expect(isBlockedIp("0:0:0:0:0:ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("0:0:0:0:0:ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("0:0:0:0:0:ffff:8.8.8.8")).toBe(false);
  });
  it("test_isBlockedIp_compressed_v6_shortforms_not_overblocked", () => {
    // review (architecture): fc::1 (=00fc::1) and fe8::1 (=0fe8::1) are NOT in
    // fc00::/7 / fe80::/10 — the numeric check must not over-block them.
    expect(isBlockedIp("fc::1")).toBe(false);
    expect(isBlockedIp("fe8::1")).toBe(false);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
  });
});

type FakeAddr = { address: string; family?: number };
const fakeLookup =
  (addrs: FakeAddr[]) =>
  async (_host: string, _opts: { all: true }): Promise<FakeAddr[]> =>
    addrs;

describe("resolveAndScreen (M3-1)", () => {
  it("test_resolveAndScreen_blocks_resolved_private", async () => {
    await expect(
      resolveAndScreen("evil.test", { lookup: fakeLookup([{ address: "127.0.0.1" }]) }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_resolveAndScreen_blocks_if_any_record_private", async () => {
    await expect(
      resolveAndScreen("mixed.test", {
        lookup: fakeLookup([{ address: "8.8.8.8" }, { address: "10.0.0.1" }]),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_resolveAndScreen_allows_public", async () => {
    await expect(
      resolveAndScreen("good.test", { lookup: fakeLookup([{ address: "8.8.8.8" }]) }),
    ).resolves.toEqual(["8.8.8.8"]);
  });
  it("test_resolveAndScreen_ip_literal_blocked", async () => {
    await expect(resolveAndScreen("169.254.169.254")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_resolveAndScreen_blocks_dual_stack_when_any_family_blocked", async () => {
    await expect(
      resolveAndScreen("dual.test", {
        lookup: fakeLookup([{ address: "8.8.8.8" }, { address: "::1" }]),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_resolveAndScreen_blocks_decimal_encoded_localhost", async () => {
    await expect(
      resolveAndScreen("2130706433", { lookup: fakeLookup([{ address: "127.0.0.1" }]) }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_resolveAndScreen_no_addresses_fails_closed", async () => {
    // review (tests): the FAILS-CLOSED invariant — empty resolution throws.
    await expect(resolveAndScreen("ghost.test", { lookup: fakeLookup([]) })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });
  it("test_resolveAndScreen_allows_public_ipv6", async () => {
    await expect(
      resolveAndScreen("v6.test", { lookup: fakeLookup([{ address: "2606:4700:4700::1111" }]) }),
    ).resolves.toEqual(["2606:4700:4700::1111"]);
  });
});

function fakeFetchSeq(responses: Array<{ status: number; location?: string }>) {
  let i = 0;
  return async (_url: string, _init?: RequestInit): Promise<Response> => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const headers = new Headers();
    if (r?.location) headers.set("location", r.location);
    return new Response(r?.status === 200 ? "body" : null, { status: r?.status ?? 200, headers });
  };
}

describe("screenedFetch (M3-1)", () => {
  const pub = { lookup: fakeLookup([{ address: "8.8.8.8" }]) };

  it("test_screenedFetch_blocks_redirect_to_private", async () => {
    await expect(
      screenedFetch("http://good.test/", {
        fetchImpl: fakeFetchSeq([{ status: 302, location: "http://127.0.0.1/" }]),
        lookup: (host: string) =>
          fakeLookup(host === "127.0.0.1" ? [{ address: "127.0.0.1" }] : [{ address: "8.8.8.8" }])(
            host,
            { all: true },
          ),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_screenedFetch_allows_public_redirect_chain", async () => {
    const res = await screenedFetch("http://good.test/", {
      fetchImpl: fakeFetchSeq([{ status: 302, location: "http://good.test/2" }, { status: 200 }]),
      ...pub,
    });
    expect(res.status).toBe(200);
  });
  it("test_screenedFetch_allowPrivateHosts_skips_screen", async () => {
    const res = await screenedFetch("http://127.0.0.1/", {
      fetchImpl: fakeFetchSeq([{ status: 200 }]),
      allowPrivateHosts: true,
    });
    expect(res.status).toBe(200);
  });
  it("test_screenedFetch_too_many_redirects", async () => {
    await expect(
      screenedFetch("http://good.test/", {
        fetchImpl: fakeFetchSeq([{ status: 302, location: "http://good.test/loop" }]),
        ...pub,
        maxRedirects: 3,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_screenedFetch_blocks_non_http_redirect", async () => {
    await expect(
      screenedFetch("http://good.test/", {
        fetchImpl: fakeFetchSeq([{ status: 302, location: "file:///etc/passwd" }]),
        ...pub,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("test_screenedFetch_308_redirect_to_private_rescreened", async () => {
    // review (tests): 307/308 method-preserving redirects are re-screened too.
    await expect(
      screenedFetch("http://good.test/", {
        fetchImpl: fakeFetchSeq([{ status: 308, location: "http://10.0.0.5/" }]),
        lookup: (host: string) =>
          fakeLookup(host === "10.0.0.5" ? [{ address: "10.0.0.5" }] : [{ address: "8.8.8.8" }])(
            host,
            { all: true },
          ),
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
