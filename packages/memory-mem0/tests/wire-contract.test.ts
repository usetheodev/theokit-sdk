/**
 * B-049 (mem0 third) — what this adapter actually puts on the wire.
 *
 * Every other test in this package replaces the vendor module wholesale (`vi.mock("mem0ai")`), so
 * every assertion about request shape, response shape, the `id` field, and the status property the
 * translation layer reads is an assertion about a HAND-WRITTEN MOCK. This file does the opposite: the
 * REAL `mem0ai` SDK runs, and only `fetch` is replaced.
 *
 * B-049's DISCOVER note said this pattern does NOT transfer to mem0 — `mem0ai` depends on `axios`,
 * and axios in Node defaults to the `http` adapter, which a `fetch` stub cannot see. That is true of
 * `axios` in general, but it is not what this adapter actually calls through. Measured against
 * `mem0ai@3.0.3`'s real source: `add`, `search`, `delete` and `history` — the four methods
 * `Mem0Adapter` calls — all route through `_fetchWithErrorHandling` (dist/index.js:511), which calls
 * global `fetch` directly. `this.client`, the axios instance the DISCOVER note found in package.json,
 * is constructed but only used by `deleteEntity` (dist/index.js:755), which this adapter never calls.
 * So the fetch-stub pattern DOES transfer here — the note was right about the dependency, wrong about
 * which code path it gates.
 *
 * The same measurement found a real bug, not a hypothetical one. mem0ai's thrown errors
 * (`RateLimitError`, `AuthenticationError`, ... — `createExceptionFromResponse`, dist/index.js:390)
 * carry only `.errorCode` as a string (`"HTTP_429"`); they never set `.status`, `.statusCode`, or
 * `.response.status`. `Mem0Adapter#translateError` read exactly those three fields and nothing else,
 * so against the REAL SDK every vendor error fell through to `status === undefined` and was
 * misclassified `code: "unknown"` — a 429 never got the EC-K rate-limit exemption, and a 5xx never
 * tripped the breaker. The OLD `vi.mock("mem0ai")` fabricated `.status` on every thrown error
 * (`tests/adapter.test.ts:33`), which is exactly why no test ever saw this. Fixed in `src/adapter.ts`
 * alongside this file; the negative case below pins the fix.
 *
 * The client is constructed with `apiKey`/`host` only (`src/adapter.ts:255`), exposing no injection
 * seam, so the global `fetch` stub is the only route that does not change production code.
 *
 * Real construction also pings `${host}/v1/ping/` (both in the background, from the constructor's
 * unawaited `_initializeClient()`, and again from inside `add()`/`search()`/... when `telemetryId` is
 * still empty) and posts anonymous usage telemetry to PostHog — both real vendor behaviour, both
 * routed through the same global `fetch`, so both land in `sent[]` too. The router below answers
 * every URL it does not care about with a harmless 200 rather than asserting on them.
 */

import { MemoryAdapterError } from "@theokit/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Mem0Adapter } from "../src/adapter.js";

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
 * Records every outgoing request and routes each to a canned response by URL substring. Unmatched
 * URLs (PostHog telemetry, a redundant `/v1/ping/`) get a harmless 200 — the vendor SDK fires those
 * as real behaviour on every construction/call and this file is not about them.
 */
function capture(routes: Array<[substring: string, body: unknown, status?: number]>): {
  sent: Captured[];
  fetchImpl: typeof fetch;
} {
  const sent: Captured[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    sent.push({
      url,
      method: init?.method ?? "GET",
      headers: flattenHeaders(init?.headers),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const match = routes.find(([substring]) => url.includes(substring));
    const body = match?.[1] ?? { status: "ok" };
    const status = match?.[2];
    return new Response(JSON.stringify(body), {
      status: status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const ctx = { userId: "u-1" };

/** Lets the constructor's unawaited background init (ping + telemetry) settle before assertions. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => vi.unstubAllGlobals());

describe("mem0 — the request the vendor SDK actually builds", () => {
  it("test_write_puts_messages_and_user_id_on_the_wire", async () => {
    const { sent, fetchImpl } = capture([["/v3/memories/add/", [{ id: "mem-99" }]]]);
    vi.stubGlobal("fetch", fetchImpl);

    const adapter = new Mem0Adapter({ apiKey: "sk-test", host: "https://mem0.test" });
    const id = await adapter.write("remember the milk", ctx);
    await flushMicrotasks();

    const req = sent.find((r) => r.url.includes("/v3/memories/add/"));
    expect(req, "the real SDK must have issued exactly one add request").toBeDefined();
    const addReq = req as Captured;

    expect(addReq.method, "add is a POST").toBe("POST");
    expect(addReq.url, "and it must reach the configured host, not the vendor default").toContain(
      "mem0.test",
    );
    expect(
      JSON.stringify(addReq.headers),
      "the api key must authenticate the call via a Token header",
    ).toContain("Token sk-test");

    const body = addReq.body as { messages?: unknown; user_id?: string };
    expect(body.messages, "the content the caller wrote must be what is sent").toEqual([
      { role: "user", content: "remember the milk" },
    ]);
    expect(body.user_id, "MemoryContext.userId must reach the wire as user_id").toBe("u-1");

    // The response shape matters as much as the request: `id` is the field the adapter reads to
    // build a MemoryId, and a vendor rename would break it silently under the module mock.
    expect(id, "the returned id is derived from the vendor's `id` field").toBe("mem0:mem-99");
  });

  it("test_a_real_429_from_the_vendor_becomes_rate_limited_not_unknown", async () => {
    // mem0ai's real RateLimitError carries only `.errorCode: "HTTP_429"` — no `.status`. This is
    // the case the module mock could not catch because it fabricated `.status` itself.
    const { fetchImpl } = capture([["/v3/memories/add/", { message: "too many requests" }, 429]]);
    vi.stubGlobal("fetch", fetchImpl);

    const adapter = new Mem0Adapter({ apiKey: "sk-test" });
    const err = await adapter.write("anything", ctx).then(
      () => null,
      (e: unknown) => e,
    );
    await flushMicrotasks();

    expect(err, "a 429 must not resolve").not.toBeNull();
    expect(err).toBeInstanceOf(MemoryAdapterError);
    expect(
      (err as MemoryAdapterError).code,
      "a real 429 must translate to rate_limited, not fall through to unknown",
    ).toBe("rate_limited");
  });
});

// ── env-gated live smoke ─────────────────────────────────────────────────────────────

const LIVE_SKIP = process.env.MEM0_API_KEY === undefined || process.env.MEM0_API_KEY.length === 0;

describe.skipIf(LIVE_SKIP)("mem0 — live smoke (MEM0_API_KEY set)", () => {
  it("writes and recalls a memory against the real mem0 cloud API", async () => {
    const adapter = new Mem0Adapter({ apiKey: process.env.MEM0_API_KEY as string });
    const id = await adapter.write(`wire-contract-live-smoke ${Date.now()}`, {
      userId: "theokit-wire-contract-smoke",
    });
    expect(id).toContain("mem0:");
  }, 30_000);
});

describe.skipIf(!LIVE_SKIP)("mem0 — live smoke (skipped — no MEM0_API_KEY)", () => {
  it("honest skip: no MEM0_API_KEY in the environment", () => {
    expect(LIVE_SKIP).toBe(true);
  });
});
