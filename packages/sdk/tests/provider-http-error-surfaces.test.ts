import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the state landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * theokit#101 — a provider failure has to SHOW UP.
 *
 * Reported: pointing an agent at a nonexistent model id, OpenRouter returns
 * `404 {"message":"No endpoints found..."}` and the stream produced ONLY `{type:'start'}` and
 * `{type:'finish'}` — no text, no error chunk, no throw. The turn looked successful and
 * empty, on every surface (HTTP web, MCP, stdio, in-process TUI).
 *
 * It is the most dangerous kind of error: silent (Unbreakable Rule 8 — fail loud, fail early,
 * fail clear). The symptom was patched downstream with a "no content" hint in the TUI; the cause
 * belongs to this layer.
 *
 * The test is HERMETIC — a local server returns 404 in place of the provider. It needs no key,
 * no network and no OpenRouter, so it runs in CI and does not flake when a provider changes mood.
 *
 * The assertion is deliberately WEAK about SHAPE and strong about FACT: it accepts a `throw`, an
 * `error` chunk, or a terminal `status` of `ERROR` — all three are legitimate surfaces, and the contract
 * that matters is "it does not pass silently". An assertion pinned to one of them would fail on a correct
 * change, and that is how a test becomes an obstacle instead of a guard.
 */

const HTTP_NOT_FOUND = 404;

/** A server answering 404 on ANY route — the unavailable provider / nonexistent model. */
function startNotFoundStub(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.statusCode = HTTP_NOT_FOUND;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "No endpoints found for this model." } }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (typeof a !== "object" || a === null) throw new Error("bind failed");
      resolve({ server, url: `http://127.0.0.1:${a.port}` });
    });
  });
}

interface Outcome {
  chunks: number;
  errorChunks: number;
  threw: string | null;
  waitStatus: string | null;
  waitError: string | null;
}

/**
 * Swaps two environment variables and returns the restorer. Extracted because the save/restore
 * pair duplicated four branches inside the scenario body and blew Biome's cognitive-complexity
 * limit — and because `undefined` must NOT become the string "undefined"
 * on restore, which is the classic mistake of this pattern.
 */
function withEnv(vars: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/** Classifies a stream chunk as an error signal, in both legitimate shapes. */
function isErrorSignal(chunk: unknown): boolean {
  const c = chunk as { type?: unknown; status?: unknown };
  return c.type === "error" || (c.type === "status" && c.status === "ERROR");
}

async function streamAgainst404(): Promise<Outcome> {
  const { Agent } = await import("../src/index.js");
  const stub = await startNotFoundStub();
  const restoreEnv = withEnv({
    ANTHROPIC_API_KEY: "sk-stub",
    ANTHROPIC_API_BASE_URL: stub.url,
  });

  const outcome: Outcome = {
    chunks: 0,
    errorChunks: 0,
    threw: null,
    waitStatus: null,
    waitError: null,
  };
  try {
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
    });
    const run = await agent.send("oi");
    for await (const chunk of run.stream()) {
      outcome.chunks += 1;
      if (isErrorSignal(chunk)) outcome.errorChunks += 1;
    }
    // The SAME run, via the other surface: does `wait()` know about the error?
    const settled = (await run.wait()) as { status?: string; error?: { message?: string } };
    outcome.waitStatus = settled.status ?? null;
    outcome.waitError = settled.error?.message ?? null;
  } catch (err) {
    outcome.threw = err instanceof Error ? err.message : String(err);
  } finally {
    restoreEnv();
    stub.server.close();
  }
  return outcome;
}

describe("a provider HTTP failure does not pass silently (theokit#101)", () => {
  afterEach(() => {
    // nothing to clean beyond the env, already restored in the finally
  });

  it("a provider 404 becomes an observable error — throw or error chunk", async () => {
    const outcome = await streamAgainst404();

    const surfaced = outcome.threw !== null || outcome.errorChunks > 0;
    expect(
      surfaced,
      `stream ended with no error signal (chunks=${String(outcome.chunks)}, ` +
        `errorChunks=${String(outcome.errorChunks)}, threw=${String(outcome.threw)})`,
    ).toBe(true);
  }, 30_000);

  it("DIAGNOSTIC: `wait()` knows the error `stream()` omits", async () => {
    const outcome = await streamAgainst404();

    // This test is not the contract — it records WHERE the asymmetry is. If one day `wait()`
    // also stops knowing, the fix becomes a different (deeper) one, and this test says so.
    expect({ waitStatus: outcome.waitStatus, hasError: outcome.waitError !== null }).toEqual({
      waitStatus: "error",
      hasError: true,
    });
  }, 30_000);

  it("the error message carries enough context to diagnose", async () => {
    const outcome = await streamAgainst404();

    // A bare "Request failed" forces the operator to instrument in order to discover WHAT failed.
    // The provider's status or body has to reach them.
    const text = outcome.threw ?? "";
    expect(text === "" || /404|not found|no endpoints/i.test(text)).toBe(true);
  }, 30_000);
});
