/**
 * M93 — as correções da revisão adversarial.
 *
 * Cada teste aqui mata um mutante que a revisão mediu SOBREVIVENDO à suíte original:
 * B1 (replay de stream parcial), H3 (regex sobre texto), H4 (dupla contagem), M2 (Retry-After,
 * sleep e guarda de abort todos removíveis sem reprovar nada).
 */
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../src/errors.js";
import { ehTransitorio, RetryingLlmClient } from "../src/internal/llm/retrying-client.js";
import type { LlmClient, LlmEvent, LlmRequest } from "../src/internal/llm/types.js";

/** `ErrorMetadata` exige provider/endpoint/code; só o status importa para estes testes. */
const META = (statusCode: number) => ({
  provider: "fake",
  endpoint: "/v1/x",
  code: "rate_limit" as const,
  statusCode,
});

const EVENTO = (t: string): LlmEvent => ({ type: "text_delta", text: t }) as unknown as LlmEvent;

/** Transporte que emite `antes` e então falha, contando tentativas. */
function transporteQueFalhaDepoisDeEmitir(antes: string[], erro: unknown) {
  const estado = { tentativas: 0 };
  const client: LlmClient = {
    name: "fake",
    async *stream(_r: LlmRequest, _s: AbortSignal) {
      estado.tentativas++;
      for (const t of antes) yield EVENTO(t);
      throw erro;
    },
  };
  return { client, estado };
}

async function coletar(c: LlmClient, signal = new AbortController().signal) {
  const saida: string[] = [];
  try {
    for await (const e of c.stream({} as LlmRequest, signal)) {
      saida.push((e as unknown as { text: string }).text);
    }
  } catch {
    /* o erro final não é o que este helper mede */
  }
  return saida;
}

describe("M93/B1 — stream parcialmente consumido NÃO é reexecutado", () => {
  it("falha DEPOIS de emitir → uma tentativa só, sem token duplicado", async () => {
    const { client, estado } = transporteQueFalhaDepoisDeEmitir(
      ["tok1", "tok2"],
      new NetworkError("socket hang up"),
    );
    const saida = await coletar(new RetryingLlmClient(client, { rng: () => 0 }));
    expect(estado.tentativas).toBe(1);
    expect(saida).toEqual(["tok1", "tok2"]);
  });

  it("falha ANTES de emitir → reexecuta normalmente", async () => {
    const { client, estado } = transporteQueFalhaDepoisDeEmitir([], new NetworkError("ECONNRESET"));
    await coletar(new RetryingLlmClient(client, { rng: () => 0 }));
    expect(estado.tentativas).toBe(3);
  });
});

describe("M93/H3 — classificação estruturada, nunca por texto", () => {
  it("erro de rede com porta 443 na mensagem É transitório quando é NetworkError", () => {
    // A regex antiga (`/\b4\d\d\b/`) casava a PORTA e excluía justamente estes.
    expect(ehTransitorio(new NetworkError("connect ECONNREFUSED 127.0.0.1:443"))).toBe(true);
    expect(ehTransitorio(new NetworkError("https://api.x:443/v1 failed, ETIMEDOUT"))).toBe(true);
    expect(ehTransitorio(new NetworkError("upstream timeout after 450 ms"))).toBe(true);
  });

  it("erro estrangeiro (não-SDK) NÃO é transitório — contrato de isTransientError", () => {
    // "wrap a foreign error in the appropriate SDK error first" — `errors.ts:429`. O transporte
    // é quem tipa; um Error cru chegando aqui é bug do transporte, não caso de retry.
    expect(ehTransitorio(new Error("connect ECONNREFUSED 127.0.0.1:443"))).toBe(false);
  });

  it("401 e 400 continuam não-transitórios", () => {
    expect(ehTransitorio(new AuthenticationError("bad key"))).toBe(false);
    expect(ehTransitorio(new ConfigurationError("bad model"))).toBe(false);
  });
});

describe("M93/H4 — o retry não reexecuta o que o pool já esgotou", () => {
  it("CredentialPoolExhaustedError não é transitório", () => {
    expect(
      ehTransitorio(new CredentialPoolExhaustedError("all keys exhausted", { provider: "x" })),
    ).toBe(false);
  });

  it("circuito aberto não é transitório — o breaker existe PARA falhar rápido", () => {
    expect(
      ehTransitorio(new NetworkError("anthropic circuit open", { code: "circuit_open" })),
    ).toBe(false);
  });

  it("401 continua não-transitório", () => {
    expect(ehTransitorio(new AuthenticationError("bad key"))).toBe(false);
  });

  it("402 (billing) continua não-transitório", () => {
    expect(ehTransitorio(new RateLimitError("payment required", { metadata: META(402) }))).toBe(
      false,
    );
  });
});

describe("M93/M2 — os mutantes que sobreviviam", () => {
  it("o backoff realmente ESPERA — remover o sleep reprova aqui", async () => {
    vi.useFakeTimers();
    try {
      const { client } = transporteQueFalhaDepoisDeEmitir([], new NetworkError("ECONNRESET"));
      // rng não-zero: sem isso `computeBackoffMs` devolve 0 e o sleep vira no-op — que é
      // exatamente por que o mutante "remove o sleep" sobrevivia na suíte original.
      const alvo = new RetryingLlmClient(client, { rng: () => 1 });
      let terminou = false;
      const p = coletar(alvo).then(() => {
        terminou = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(terminou, "terminou sem esperar o backoff").toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      await p;
      expect(terminou).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o Retry-After do provider é honrado — DoD do M93", async () => {
    vi.useFakeTimers();
    try {
      const erro = new RateLimitError("slow down", { metadata: { ...META(429), retryAfter: 30 } });
      const { client, estado } = transporteQueFalhaDepoisDeEmitir([], erro);
      const p = coletar(new RetryingLlmClient(client, { rng: () => 0 }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(estado.tentativas, "reexecutou antes do Retry-After de 30 s").toBe(1);
      await vi.advanceTimersByTimeAsync(120_000);
      await p;
      expect(estado.tentativas).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("um signal já abortado na entrada não chama o transporte", async () => {
    const { client, estado } = transporteQueFalhaDepoisDeEmitir([], new NetworkError("x"));
    const ac = new AbortController();
    ac.abort(new Error("cancelado pelo usuário"));
    await expect(coletar(new RetryingLlmClient(client), ac.signal)).resolves.toEqual([]);
    expect(estado.tentativas).toBe(0);
  });
});
