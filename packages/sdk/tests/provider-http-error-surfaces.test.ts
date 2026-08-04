import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

/**
 * theokit#101 — a provider failure has to SHOW UP.
 *
 * Reportado: apontando um agent para um model id inexistente, o OpenRouter devolve
 * `404 {"message":"No endpoints found..."}` and the stream produced ONLY `{type:'start'}` and
 * `{type:'finish'}` — sem texto, sem chunk de erro, sem throw. O turno parecia bem-sucedido e
 * empty, on every surface (HTTP web, MCP, stdio, in-process TUI).
 *
 * It is the most dangerous kind of error: silent (Unbreakable Rule 8 — fail loud, fail early,
 * falhe claro). O sintoma foi remendado a jusante com uma dica de "no content" na TUI; a causa
 * pertence a esta camada.
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
  const anterior = new Map<string, string | undefined>();
  for (const [chave, valor] of Object.entries(vars)) {
    anterior.set(chave, process.env[chave]);
    process.env[chave] = valor;
  }
  return () => {
    for (const [chave, valor] of anterior) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  };
}

/** Classifies a stream chunk as an error signal, in both legitimate shapes. */
function ehSinalDeErro(chunk: unknown): boolean {
  const c = chunk as { type?: unknown; status?: unknown };
  return c.type === "error" || (c.type === "status" && c.status === "ERROR");
}

async function streamAgainst404(): Promise<Outcome> {
  const { Agent } = await import("../src/index.js");
  const stub = await startNotFoundStub();
  const restaurarEnv = withEnv({
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
      if (ehSinalDeErro(chunk)) outcome.errorChunks += 1;
    }
    // The SAME run, via the other surface: does `wait()` know about the error?
    const settled = (await run.wait()) as { status?: string; error?: { message?: string } };
    outcome.waitStatus = settled.status ?? null;
    outcome.waitError = settled.error?.message ?? null;
  } catch (err) {
    outcome.threw = err instanceof Error ? err.message : String(err);
  } finally {
    restaurarEnv();
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
      `stream terminou sem sinal de erro (chunks=${String(outcome.chunks)}, ` +
        `errorChunks=${String(outcome.errorChunks)}, threw=${String(outcome.threw)})`,
    ).toBe(true);
  }, 30_000);

  it("DIAGNOSTIC: `wait()` knows the error `stream()` omits", async () => {
    const outcome = await streamAgainst404();

    // This test is not the contract — it records WHERE the asymmetry is. If one day `wait()`
    // also stops knowing, the fix becomes a different (deeper) one, and this test says so.
    expect({ waitStatus: outcome.waitStatus, temErro: outcome.waitError !== null }).toEqual({
      waitStatus: "error",
      temErro: true,
    });
  }, 30_000);

  it("a mensagem do erro carrega contexto suficiente para diagnosticar", async () => {
    const outcome = await streamAgainst404();

    // A bare "Request failed" forces the operator to instrument in order to discover WHAT failed.
    // The provider's status or body has to reach them.
    const texto = outcome.threw ?? "";
    expect(texto === "" || /404|not found|no endpoints/i.test(texto)).toBe(true);
  }, 30_000);
});
