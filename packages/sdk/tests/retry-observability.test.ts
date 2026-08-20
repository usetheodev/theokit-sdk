import { afterEach, describe, expect, it, vi } from "vitest";

import { RateLimitError } from "../src/errors.js";
import { setDiagnosticsSink } from "../src/internal/diagnostics.js";
import { MAX_ATTEMPTS, RetryingLlmClient } from "../src/internal/llm/retrying-client.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../src/internal/llm/types.js";

/**
 * theokit-sdk#165 — a retry that does not announce itself is indistinguishable from no retry.
 *
 * The issue reports a 429 in ~3s "with no observable retry" and concludes the retry path is never
 * reached. The conclusion is reasonable and wrong: `RetryingLlmClient` wraps EVERY arm of the router
 * (M93), and the backoff is full-jitter — `floor(random() * ceiling)` — so three attempts can
 * legitimately complete in milliseconds and vanish inside the response latency.
 *
 * The real defect is not a missing retry; it is a SILENT one. With no per-attempt signal, whoever is
 * debugging sees only the final error, and the only hypothesis available is the wrong one. These
 * tests pin the signal.
 */
const rate429 = (): RateLimitError =>
  new RateLimitError("openai API error: rate_limit (HTTP 429)", {
    code: "openai_rate_limit",
    metadata: { statusCode: 429 } as never,
  });

/** A transport that only fails. No credential and no provider are required. */
const alwaysFails = (error: unknown): LlmClient => ({
  name: "fake",
  // eslint-disable-next-line @typescript-eslint/require-await
  // biome-ignore lint/correctness/useYield: a transport that ONLY fails — not emitting is the point
  async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
    throw error;
  },
});

const drain = async (c: LlmClient): Promise<void> => {
  const gen = c.stream({} as never, new AbortController().signal);
  let step = await gen.next();
  while (step.done !== true) step = await gen.next();
};

afterEach(() => {
  setDiagnosticsSink(undefined);
});

describe("theokit-sdk#165 — the retry must be observable", () => {
  it("test_every_attempt_emits_a_diagnostic", async () => {
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    // `rng: () => 0` zeroes the jitter: this test measures the SIGNAL, not the clock.
    const client = new RetryingLlmClient(alwaysFails(rate429()), { rng: () => 0 });
    await expect(drain(client)).rejects.toBeInstanceOf(RateLimitError);

    // MAX_ATTEMPTS attempts => MAX_ATTEMPTS-1 announced waits (the final failure does not wait).
    const retries = seen.filter((m) => m.includes("retry"));
    expect(retries).toHaveLength(MAX_ATTEMPTS - 1);
  });

  it("test_the_diagnostic_names_attempt_ceiling_and_cause", async () => {
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    const client = new RetryingLlmClient(alwaysFails(rate429()), { rng: () => 0 });
    // B-079 — was bare `.rejects.toThrow()`. The mock always fails with the
    // typed `RateLimitError` this file constructs (`rate429()`); the exhausted
    // client re-throws it verbatim, so class + code are stable identifiers.
    await expect(drain(client)).rejects.toThrow(RateLimitError);
    await expect(drain(client)).rejects.toMatchObject({ code: "openai_rate_limit" });

    const first = seen.find((m) => m.includes("retry"));
    expect(first, "no retry diagnostic was emitted").toBeDefined();
    // Whoever is debugging needs all three: which attempt, out of how many, and why.
    expect(first).toContain(`1/${MAX_ATTEMPTS}`);
    expect(first).toContain("RateLimitError");
    expect(first).toMatch(/\d+\s*ms/);
    // The message ships to consumers, and this repo is English-only. The lint gate cannot see a
    // two-letter word inside a template literal — it shipped `em` past review once. Pin the wording.
    expect(first).toMatch(/retry \d+\/\d+ in \d+ms/);
  });

  it("test_with_no_sink_installed_nothing_reaches_the_terminal", async () => {
    // B-066. The test is named for silence ON THE TERMINAL and used to end in
    // `expect(true).toBe(true)` — it never observed the channel it claims stays quiet. Its comment
    // said "reaching here without throwing already proves emission does not depend on an installed
    // sink", which proves the retry path runs, not that nothing was written. Spying the real stream
    // is what makes a regression to `console.error` fail this test instead of passing it.
    //
    // The assertion demands TOTAL silence rather than the absence of writes matching /retry/. The
    // narrower form was the first fix and it weakens exactly when it matters: a regression that
    // wrote "rate limited, backing off" would satisfy it while violating the test's name.
    setDiagnosticsSink(undefined);
    const writes: string[] = [];
    const err = vi.spyOn(process.stderr, "write").mockImplementation(((c: string) => {
      writes.push(String(c));
      return true;
    }) as never);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(((c: string) => {
      writes.push(String(c));
      return true;
    }) as never);

    try {
      const client = new RetryingLlmClient(alwaysFails(rate429()), { rng: () => 0 });
      // B-079 — was bare `.rejects.toThrow()`. Same typed `RateLimitError` as above.
      await expect(drain(client)).rejects.toThrow(RateLimitError);

      expect(
        writes,
        "with no sink installed the library must not write to the host's terminal",
      ).toEqual([]);
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
  });

  it("test_first_attempt_success_emits_no_noise", async () => {
    const seen: string[] = [];
    setDiagnosticsSink((m) => seen.push(m));

    const ok: LlmClient = {
      name: "fake",
      // eslint-disable-next-line @typescript-eslint/require-await
      // biome-ignore lint/correctness/useYield: returns without emitting an event
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        return { stopReason: "stop", text: "", toolCalls: [] } as unknown as LlmFinish;
      },
    };
    await drain(new RetryingLlmClient(ok, { rng: () => 0 }));
    expect(seen.filter((m) => m.includes("retry"))).toHaveLength(0);
  });
});
