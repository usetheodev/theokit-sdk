import { TheokitAgentError } from "../../errors.js";
/**
 * Judge call primitive (T2.2, ADRs D119-D121).
 *
 * Instantiates a short-lived auxiliary agent that evaluates whether a
 * goal is satisfied. The auxiliary judge runs with `tools: []` and a
 * cheap model (default `openai/gpt-4o-mini`) — see ADR D119. The judge
 * model needs only API access; we read `OPENROUTER_API_KEY` directly
 * from the environment (EC-A — single source of truth) and let the
 * caller override via {@link JudgeOptions.apiKey} for Anthropic or
 * direct-OpenAI environments.
 *
 * NOTE: judge aux agents created from inside a `forkAgent` context will
 * inherit the parent fork's whitelist via AsyncLocalStorage (EC-J).
 * `tools: []` keeps this benign today; future callers that add tools to
 * a judge should be aware.
 *
 * @internal
 */

import type { AgentOptions, SDKAgent } from "../../types/agent.js";
import type { JudgeResult } from "../../types/goal-events.js";
import { parseVerdict } from "./parse-verdict.js";

/** Inputs to the judge — pure data. */
export interface JudgeContext {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
}

/** Caller-supplied tuning knobs for the judge call. */
export interface JudgeOptions {
  /**
   * Judge model identifier. Quando ausente, DERIVA de {@link agentModel} — e só cai no literal
   * `"openai/gpt-4o-mini"` se nem esse for informado.
   *
   * M80 — o default fixo era provider-cego: ele só resolve em OpenRouter. Com chave Anthropic dá
   * 404, com bearer OAuth dá 401, e em ambos o goal queimava 3 turnos inteiros antes de falhar com
   * razão enganosa. O agent-builder já contornava isso derivando por conta própria; o conhecimento
   * pertence aqui.
   */
  judgeModel?: string;
  /**
   * M80 — o modelo do agente CONDUZIDO. É a base da derivação: um judge que roda no mesmo modelo do
   * chat funciona onde o chat funciona.
   */
  agentModel?: string;
  /** Override env. Default `process.env.OPENROUTER_API_KEY` (EC-A). */
  apiKey?: string;
}

/**
 * M80 — a credencial ou o modelo do judge não servem: 401/404.
 *
 * Falha RÁPIDA por design. `rules/error-handling.md § 2` separa recuperável de irrecuperável, e um
 * modelo inexistente não passa a existir no retry — dobrar isso em `{parseFailed: true}` fazia o loop
 * tentar três vezes e reportar "failed" por limite de falhas consecutivas, escondendo que a causa era
 * credencial. Falha lenta e opaca trocada por rápida e clara.
 *
 * Falha de PARSE e erro de rede continuam dobrados: são recuperáveis, e o loop já decide por falhas
 * consecutivas.
 */
export class JudgeCredentialError extends TheokitAgentError {
  override readonly name = "JudgeCredentialError";

  constructor(
    readonly httpStatus: number,
    readonly judgeModel: string,
    cause: unknown,
  ) {
    super(
      `judge unavailable: model "${judgeModel}" returned ${String(httpStatus)}. ` +
        "Pass `judgeModel`/`apiKey` that resolve for this provider, or omit `judgeModel` to derive " +
        "it from the agent being driven.",
      { code: "judge_credential", cause, isRetryable: false },
    );
  }
}

/** Extrai o status HTTP de um erro de provider, quando ele o carrega. */
function statusHttpDe(err: unknown): number | undefined {
  const s =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof s === "number") return s;
  const m = /\b(401|403|404)\b/.exec(err instanceof Error ? err.message : String(err));
  return m?.[1] !== undefined ? Number(m[1]) : undefined;
}

/** Dependencies injected so `judge-call.ts` stays free of `Agent` import. */
export interface JudgeDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

/**
 * Run the judge auxiliary agent and parse the verdict. Always returns a
 * `JudgeResult` — failures are folded into `{ parseFailed: true,
 * verdict: "continue" }` so the loop can decide based on consecutive
 * failures (ADR D121).
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: judge call must (1) check env or override, (2) catch errors as fail-safe, (3) ensure aux dispose runs once regardless of outcome — three concerns linearly arranged, harm clarity to extract.
export async function judgeCallImpl(
  ctx: JudgeContext,
  options: JudgeOptions | undefined,
  deps: JudgeDeps,
): Promise<JudgeResult> {
  const prompt = composeJudgePrompt(ctx);
  // EC-A: single env source — OpenRouter only. No multi-provider fallback.
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined) {
    return {
      verdict: "continue",
      reason:
        "judge unavailable: OPENROUTER_API_KEY missing and no override passed via options.apiKey",
      parseFailed: true,
    };
  }

  // M80 — precedência: explícito > modelo do agente conduzido > o literal histórico. O literal só
  // sobrevive como último recurso, para não quebrar quem nunca passou nenhum dos dois.
  const judgeModel = options?.judgeModel ?? options?.agentModel ?? "openai/gpt-4o-mini";
  let auxAgent: SDKAgent | undefined;
  try {
    auxAgent = await deps.create({
      apiKey,
      model: { id: judgeModel },
      tools: [],
      local: {},
      metadata: { forkOrigin: "judge" },
    } as AgentOptions);
    const run = await auxAgent.send(prompt);
    const result = await run.wait();
    return parseVerdict(result.result ?? "");
  } catch (err) {
    // M80 — 401/403/404 são de credencial/modelo: irrecuperáveis, falham rápido e tipado. Todo o
    // resto (rede, timeout, 5xx) segue dobrado, porque É recuperável e o loop já decide por falhas
    // consecutivas.
    const status = statusHttpDe(err);
    if (status === 401 || status === 403 || status === 404) {
      throw new JudgeCredentialError(status, judgeModel, err);
    }
    return {
      verdict: "continue",
      reason: `judge call failed: ${err instanceof Error ? err.message : String(err)}`,
      parseFailed: true,
    };
  } finally {
    if (auxAgent !== undefined) {
      try {
        await auxAgent.dispose();
      } catch {
        // dispose errors are non-fatal; judge result is already prepared
      }
    }
  }
}

/**
 * Build the strict-format prompt the judge expects.
 *
 * @internal
 */
export function composeJudgePrompt(ctx: JudgeContext): string {
  const subgoals =
    ctx.subgoals !== undefined && ctx.subgoals.length > 0 ? ctx.subgoals.join(", ") : "(none)";
  return `You are a goal judge. Determine if this goal is satisfied.

Goal: ${ctx.goal}
Subgoals: ${subgoals}
Last agent response: ${ctx.lastResponse}

Respond with EXACTLY one of:
- DONE: <reason>
- CONTINUE: <what's left>
- SKIPPED: <why not applicable>

Be strict. If unclear, prefer CONTINUE.`;
}
