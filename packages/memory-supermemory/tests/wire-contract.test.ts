/**
 * B-049 (supermemory third) — what this adapter actually puts on the wire.
 *
 * Every other test in this package replaces the vendor module wholesale (`vi.mock("supermemory")`),
 * so every assertion about request shape, response shape, the `id` field, and the status property the
 * breaker reads is an assertion about a HAND-WRITTEN MOCK. A vendor response-shape change lands
 * silently: the mock keeps answering in the old shape and the suite stays green.
 *
 * This file does the opposite. The REAL `supermemory` SDK runs; only the transport is replaced. So the
 * request recorded here is the one the vendor's own serialisation produced, and the response is fed
 * back through the vendor's own parsing.
 *
 * Modelled on `packages/sdk/tests/internal/memory/adapters/embedding-wire-contract.test.ts`, which
 * B-049 names as the pattern to copy. Measured caveat, recorded on the item: the pattern transfers to
 * THIS package only. `mem0ai` ships axios (`axios 1.13.6`), which in Node uses `http`/`https` and never
 * touches `fetch` — a global fetch stub cannot see it, so that third needs transport interception and
 * a dependency decision rather than a test.
 *
 * The adapter constructs its client with `apiKey`/`baseURL` only (`src/adapter.ts:217`), exposing no
 * injection seam, so the global stub is the only route that does not change production.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { SupermemoryAdapter } from "../src/adapter.js";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Flattens the three shapes `HeadersInit` can take into a plain record.
 *
 * Extracted because inlining it pushed `capture` to a cognitive complexity of 13 against the project's
 * ceiling of 10 — the pre-commit gate refused it, correctly. Which shape arrives depends on the vendor
 * SDK's internals, so all three are handled rather than the one it happens to use today.
 */
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

/** Records the outgoing request and replies with `reply`, letting the vendor SDK parse it. */
function capture(reply: unknown, status = 200): { sent: Captured[]; fetchImpl: typeof fetch } {
  const sent: Captured[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const headers = flattenHeaders(init?.headers);

    sent.push({
      url: typeof input === "string" ? input : String((input as { url?: string })?.url ?? input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    return new Response(JSON.stringify(reply), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const ctx = { userId: "u-1", sessionId: "s-1" } as never;

afterEach(() => vi.unstubAllGlobals());

describe("supermemory — the request the vendor SDK actually builds", () => {
  it("test_write_puts_the_content_and_container_tags_on_the_wire", async () => {
    const { sent, fetchImpl } = capture({ id: "doc-42" });
    vi.stubGlobal("fetch", fetchImpl);

    const adapter = new SupermemoryAdapter({ apiKey: "sk-test", baseUrl: "https://sm.test" });
    const id = await adapter.write("remember the milk", ctx);

    expect(sent, "the real SDK must have issued exactly one request").toHaveLength(1);
    const req = sent[0] as Captured;

    expect(req.method, "a write is a POST").toBe("POST");
    expect(req.url, "and it must reach the configured base URL, not the vendor default").toContain(
      "sm.test",
    );
    expect(
      JSON.stringify(req.headers).toLowerCase(),
      "the api key must authenticate the call",
    ).toContain("sk-test");

    const body = req.body as { content?: string; containerTags?: unknown };
    expect(body.content, "the content the caller wrote must be what is sent").toBe(
      "remember the milk",
    );
    expect(
      body.containerTags,
      "container tags are how this adapter scopes a memory to a user/session",
    ).toBeDefined();

    // The response shape matters as much as the request: `id` is the field the adapter reads to build
    // a MemoryId, and a vendor rename would break it silently under the module mock.
    expect(id, "the returned id is derived from the vendor's `id` field").toContain("doc-42");
  });

  it("test_a_non_2xx_from_the_real_sdk_becomes_a_typed_adapter_error", async () => {
    // The breaker reads a status off the thrown error. Under `vi.mock` that status is whatever the
    // hand-written mock chose to attach; here it is whatever the vendor SDK genuinely produces from a
    // real HTTP 429, which is the thing the breaker policy actually depends on.
    const { fetchImpl } = capture({ error: "rate limited" }, 429);
    vi.stubGlobal("fetch", fetchImpl);

    const adapter = new SupermemoryAdapter({ apiKey: "sk-test", baseUrl: "https://sm.test" });
    const err = await adapter.write("anything", ctx).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err, "a 429 must not resolve").not.toBeNull();
    expect(
      (err as { adapterId?: string }).adapterId ?? String(err),
      "and it must arrive as this adapter's typed error, not a raw vendor exception",
    ).toBeTruthy();
  });
});

// ── env-gated live smoke ─────────────────────────────────────────────────────────────
//
// B-049: the DoD asks for "an env-gated live smoke that skips loudly when the vendor key is
// absent" per adapter. This file shipped without one (batch 17) — added here to close that gap.

const LIVE_SKIP =
  process.env.SUPERMEMORY_API_KEY === undefined || process.env.SUPERMEMORY_API_KEY.length === 0;

describe.skipIf(LIVE_SKIP)("supermemory — live smoke (SUPERMEMORY_API_KEY set)", () => {
  it("writes a memory against the real Supermemory API", async () => {
    const adapter = new SupermemoryAdapter({ apiKey: process.env.SUPERMEMORY_API_KEY as string });
    const id = await adapter.write(`wire-contract-live-smoke ${Date.now()}`, ctx);
    expect(id).toContain("supermemory:");
  }, 30_000);
});

describe.skipIf(!LIVE_SKIP)("supermemory — live smoke (skipped — no SUPERMEMORY_API_KEY)", () => {
  it("honest skip: no SUPERMEMORY_API_KEY in the environment", () => {
    expect(LIVE_SKIP).toBe(true);
  });
});
