import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

/**
 * theokit#101 — uma falha do provider tem de APARECER.
 *
 * Reportado: apontando um agent para um model id inexistente, o OpenRouter devolve
 * `404 {"message":"No endpoints found..."}` e o stream produzia SÓ `{type:'start'}` e
 * `{type:'finish'}` — sem texto, sem chunk de erro, sem throw. O turno parecia bem-sucedido e
 * vazio, em toda superfície (HTTP web, MCP, stdio, TUI in-process).
 *
 * É a forma mais perigosa de erro: silencioso (Regra Inquebrável 8 — falhe alto, falhe cedo,
 * falhe claro). O sintoma foi remendado a jusante com uma dica de "no content" na TUI; a causa
 * pertence a esta camada.
 *
 * O teste é HERMÉTICO — um servidor local devolve 404 no lugar do provider. Não precisa de chave,
 * de rede nem de OpenRouter, então roda no CI e não fica flaky quando um provider muda de humor.
 *
 * A asserção é deliberadamente FRACA quanto à FORMA e forte quanto ao FATO: aceita `throw`, um
 * chunk `error`, ou um `status` terminal `ERROR` — as três são superfícies legítimas, e o contrato
 * que importa é "não passa em silêncio". Uma asserção presa a uma delas reprovaria numa mudança
 * correta, e é assim que um teste vira obstáculo em vez de guarda.
 */

const HTTP_NOT_FOUND = 404;

/** Servidor que responde 404 a QUALQUER rota — o provider indisponível/model inexistente. */
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

async function streamAgainst404(): Promise<Outcome> {
  const { Agent } = await import("../src/index.js");
  const stub = await startNotFoundStub();
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  process.env.ANTHROPIC_API_KEY = "sk-stub";
  process.env.ANTHROPIC_API_BASE_URL = stub.url;

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
      const c = chunk as { type?: unknown; status?: unknown };
      // Duas formas legítimas de sinalizar erro no stream: um chunk `error` (forma da camada
      // @theokit/agents) ou um `status` terminal `ERROR` (forma que a união SDKMessage já tem).
      if (c.type === "error" || (c.type === "status" && c.status === "ERROR")) {
        outcome.errorChunks += 1;
      }
    }
    // O MESMO run, pela outra superfície: `wait()` conhece o erro?
    const settled = (await run.wait()) as { status?: string; error?: { message?: string } };
    outcome.waitStatus = settled.status ?? null;
    outcome.waitError = settled.error?.message ?? null;
  } catch (err) {
    outcome.threw = err instanceof Error ? err.message : String(err);
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub.server.close();
  }
  return outcome;
}

describe("falha HTTP do provider não passa em silêncio (theokit#101)", () => {
  afterEach(() => {
    // nada a limpar além do env, já restaurado no finally
  });

  it("um 404 do provider vira erro observável — throw ou chunk de erro", async () => {
    const outcome = await streamAgainst404();

    const surfaced = outcome.threw !== null || outcome.errorChunks > 0;
    expect(
      surfaced,
      `stream terminou sem sinal de erro (chunks=${String(outcome.chunks)}, ` +
        `errorChunks=${String(outcome.errorChunks)}, threw=${String(outcome.threw)})`,
    ).toBe(true);
  }, 30_000);

  it("DIAGNÓSTICO: `wait()` conhece o erro que `stream()` omite", async () => {
    const outcome = await streamAgainst404();

    // Este teste não é o contrato — é o registro de ONDE está a assimetria. Se um dia `wait()`
    // também parar de saber, a correção passa a ser outra (mais funda), e este teste avisa.
    expect({ waitStatus: outcome.waitStatus, temErro: outcome.waitError !== null }).toEqual({
      waitStatus: "error",
      temErro: true,
    });
  }, 30_000);

  it("a mensagem do erro carrega contexto suficiente para diagnosticar", async () => {
    const outcome = await streamAgainst404();

    // Um "Request failed" pelado obriga o operador a instrumentar para descobrir O QUÊ falhou.
    // O status ou o corpo do provider tem de chegar até ele.
    const texto = outcome.threw ?? "";
    expect(texto === "" || /404|not found|no endpoints/i.test(texto)).toBe(true);
  }, 30_000);
});
