/**
 * B-049 (honcho third) — what this adapter actually puts on the wire.
 *
 * Every other test in this package replaces the vendor module wholesale (`vi.mock("@honcho-ai/sdk")`),
 * so every assertion about request shape, response shape, and the `id` field the adapter reads is an
 * assertion about a HAND-WRITTEN MOCK. This file does the opposite: the REAL `@honcho-ai/sdk` runs,
 * and only `fetch` is replaced.
 *
 * B-049's DISCOVER note left this package's transport "not determined". Measured against
 * `@honcho-ai/sdk@2.1.1`'s real source: it has NO axios/http dependency at all (its `package.json`
 * declares only `zod`) — `HonchoHTTPClient.request` (dist/http/client.js:29) calls global `fetch`
 * directly, with automatic retry on 429/5xx. So the fetch-stub pattern transfers here too, the same
 * as it does for `memory-supermemory`.
 *
 * One `HonchoAdapter.write()` call is NOT one HTTP request — the vendor SDK's get-or-create model
 * means it is a CHAIN of five real requests: get-or-create workspace (memoized per client instance),
 * get-or-create peer, get-or-create session, add the peer to the session, then post the message. This
 * file pins the last one — `POST /v3/workspaces/{ws}/sessions/{sid}/messages`, the request that
 * actually carries the content the caller wrote — and lets every other hop in the chain succeed with
 * a minimal fixture, the same way a real Honcho workspace would respond.
 *
 * The adapter constructs its client with `apiKey`/`workspaceId`/`baseUrl` only (`src/adapter.ts:196`),
 * exposing no injection seam, so the global `fetch` stub is the only route that does not change
 * production code.
 */

import { MemoryAdapterError } from "@theokit/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HonchoAdapter } from "../src/adapter.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Flattens the three shapes `HeadersInit` can take into a plain record. */
function flattenHeaders(raw: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    for (const [k, v] of raw.entries()) out[k] = v;
    return out;
  }
  if (Array.isArray(raw)) {
    for (const [k, v] of raw) out[String(k)] = String(v);
    return out;
  }
  for (const [k, v] of Object.entries(raw ?? {}))
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  return out;
}

/**
 * Records every outgoing request and routes each to a canned response by URL substring, first match
 * wins. Every hop the vendor SDK makes to get-or-create a workspace/peer/session gets a minimal
 * fixture unless the test overrides it — this file cares about the request each hop SENDS, not the
 * shape of the intermediate responses, except where noted.
 */
function capture(overrides: Array<[substring: string, body: unknown, status?: number]> = []): {
  sent: Captured[];
  fetchImpl: typeof fetch;
} {
  const sent: Captured[] = [];
  const defaults: Array<[string, unknown]> = [
    [
      "/sessions",
      { id: "s-1", metadata: {}, configuration: {}, created_at: "2026-01-01", is_active: true },
    ],
    ["/peers", { id: "p-1", metadata: {}, configuration: {}, created_at: "2026-01-01" }],
    ["/workspaces", { id: "ws-1" }],
  ];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    sent.push({
      url,
      method: init?.method ?? "GET",
      headers: flattenHeaders(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const match = [...overrides, ...defaults].find(([substring]) => url.includes(substring));
    const body = match?.[1] ?? {};
    const status = match?.[2];
    return new Response(JSON.stringify(body), {
      status: status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const ctx = { userId: "u-1" };

afterEach(() => vi.unstubAllGlobals());

describe("honcho — the request the vendor SDK actually builds", () => {
  it("test_write_puts_the_message_content_on_the_wire_via_the_real_getOrCreate_chain", async () => {
    const { sent, fetchImpl } = capture([
      [
        "/messages",
        [
          {
            id: "msg-42",
            content: "remember the milk",
            peer_id: "u-1",
            session_id: "u-1:default",
            workspace_id: "default",
            metadata: {},
            created_at: "2026-01-01",
            token_count: 3,
          },
        ],
      ],
    ]);
    vi.stubGlobal("fetch", fetchImpl);

    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const id = await adapter.write("remember the milk", ctx);

    const messagesReq = sent.find((r) => r.url.includes("/messages") && r.method === "POST");
    expect(messagesReq, "the real SDK must have posted the message").toBeDefined();
    const req = messagesReq as Captured;

    expect(
      JSON.stringify(req.headers).toLowerCase(),
      "the api key must authenticate the call",
    ).toContain("sk-test");

    const body = req.body as { messages?: Array<{ content?: string; peer_id?: string }> };
    expect(body.messages?.[0]?.content, "the content the caller wrote must be what is sent").toBe(
      "remember the milk",
    );
    expect(
      body.messages?.[0]?.peer_id,
      "the peer key derived from MemoryContext.userId must reach the wire",
    ).toBe("u-1");

    // The response shape matters as much as the request: `id` is the field the adapter reads to
    // build a MemoryId, and a vendor rename would break it silently under the module mock.
    expect(id, "the returned id is derived from the vendor's `id` field").toBe("honcho:msg-42");

    // The get-or-create chain really did run against the workspace this client was configured for —
    // not a value the adapter invented.
    expect(sent.some((r) => r.url.includes("/workspaces") && r.method === "POST")).toBe(true);
    expect(sent.some((r) => r.url.includes("/peers") && r.method === "POST")).toBe(true);
  });

  it("test_a_real_429_from_the_vendor_becomes_rate_limited_not_unknown", async () => {
    // Every hop in the get-or-create chain is routed to 429 with `Retry-After: 0` so the SDK's
    // built-in retry (default maxRetries=2) exhausts immediately instead of sleeping with
    // exponential backoff.
    const { fetchImpl } = capture([["/workspaces", { error: "rate limited" }, 429]]);
    const rateLimited = (async (input: unknown, init?: RequestInit) => {
      const res = await fetchImpl(input as never, init);
      if (String(input).includes("/workspaces")) {
        return new Response(await res.clone().text(), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "0" },
        });
      }
      return res;
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", rateLimited);

    const adapter = new HonchoAdapter({ apiKey: "sk-test" });
    const err = await adapter.write("anything", ctx).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err, "a 429 must not resolve").not.toBeNull();
    expect(err).toBeInstanceOf(MemoryAdapterError);
    expect(
      (err as MemoryAdapterError).code,
      "a real 429 must translate to rate_limited, not fall through to unknown",
    ).toBe("rate_limited");
  }, 10_000);
});

// ── env-gated live smoke ─────────────────────────────────────────────────────────────

const LIVE_SKIP =
  process.env.HONCHO_API_KEY === undefined || process.env.HONCHO_API_KEY.length === 0;

describe.skipIf(LIVE_SKIP)("honcho — live smoke (HONCHO_API_KEY set)", () => {
  it("writes a memory against the real Honcho API", async () => {
    const adapter = new HonchoAdapter({ apiKey: process.env.HONCHO_API_KEY as string });
    const id = await adapter.write(`wire-contract-live-smoke ${Date.now()}`, {
      userId: "theokit-wire-contract-smoke",
    });
    expect(id).toContain("honcho:");
  }, 30_000);
});

describe.skipIf(!LIVE_SKIP)("honcho — live smoke (skipped — no HONCHO_API_KEY)", () => {
  it("honest skip: no HONCHO_API_KEY in the environment", () => {
    expect(LIVE_SKIP).toBe(true);
  });
});
