/**
 * M80 — os verdicts terminais que um judge pode devolver.
 *
 * `"blocked"` entrou aqui neste milestone. `GoalResult.status` já o carregava, mas o judge não tinha
 * como EMITI-LO: seu vocabulário era `done | continue | skipped`, então diante de um bloqueio real
 * ele só podia dizer `continue` — e o loop repetia o mesmo turno até estourar o orçamento,
 * reportando `failed` por limite em vez de `blocked` por impossibilidade. Duas causas diferentes com
 * o mesmo desfecho visível.
 *
 * @public
 */
export type Verdict = "done" | "continue" | "skipped" | "blocked";

/**
 * M80 — resultado de uma chamada ao judge, agora público.
 *
 * Era `internal/`, então um consumidor que quisesse tipar o retorno — para reagir a `blocked` sem
 * string mágica — precisava redeclarar a forma. É a mesma duplicação que o M78 fechou para a
 * hierarquia de erro: sem superfície pública, reimplementar é a única saída legal para quem está
 * atrás da fronteira de camadas.
 *
 * @public
 */
export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  /**
   * `true` quando o texto não começou com um dos prefixos canônicos. O verdict vira `"continue"`
   * (fail-safe) para não parar cedo demais; o chamador conta falhas consecutivas e desiste via
   * `maxConsecutiveJudgeFailures`.
   */
  parseFailed: boolean;
}

/**
 * Public event types emitted by {@link SDKAgent.runUntil} (ADRs D115-D117).
 *
 * Discriminated union by `type` field so consumers can `switch (event.type)`
 * with full TypeScript exhaustiveness. Mirrors the
 * {@link import("../stream-object.js").StreamObjectEvent} pattern (ADR D39).
 *
 * @public
 */

/**
 * Single event emitted while iterating a goal-driven loop. Five variants:
 *
 * - `turn_start` — the agent is about to invoke `send()`. Emitted once
 *   per turn.
 * - `agent_response` — the agent's `send()` resolved; carries the text
 *   reply.
 * - `judge_verdict` — the auxiliary judge model evaluated the response.
 *   `parseFailed: true` indicates the judge returned a malformed reply
 *   (fail-safe verdict = `continue`, see ADR D121).
 * - `continuation` — the judge ruled `continue`; carries the prompt that
 *   was sent on THIS turn (i.e., the input that produced the agent
 *   response just yielded). Useful for consumers who want to audit the
 *   exact continuation message that drove each iteration. The prompt
 *   for the NEXT turn is composed lazily at the start of that turn
 *   from the latest `agent_response.content`.
 * - `status_change` — transition of the overall goal state. Always
 *   emitted once at start (`active`) and once at end
 *   (`completed | failed | paused`).
 *
 * @public
 */
export type GoalEvent =
  | { type: "turn_start"; turn: number; goal: string }
  | { type: "agent_response"; turn: number; content: string }
  | {
      type: "judge_verdict";
      turn: number;
      /** M80 — `"blocked"` entrou: o judge pode declarar impossibilidade, não só "continue". */
      verdict: "done" | "continue" | "skipped" | "blocked";
      reason: string;
      parseFailed: boolean;
    }
  | { type: "continuation"; turn: number; prompt: string }
  | {
      type: "status_change";
      // M55 — estados fiéis ao Codex (ext/goal tool.rs:467-476). `budget_limited` = cruzou o tokenBudget;
      // `blocked` reservado p/ o impasse ≥3 turnos (v1 usa failed). Aditivo — consumidores exaustivos
      // ganham casos novos.
      status: "active" | "paused" | "completed" | "failed" | "budget_limited" | "blocked";
      reason: string;
    };

/**
 * Return value of the `runUntil` async generator. Consumer reads via
 * `const { value } = await gen.next()` (when `done: true`).
 *
 * @public
 */
export interface GoalResult {
  status: "completed" | "failed" | "paused" | "budget_limited" | "blocked";
  turnsUsed: number;
  /** M55 — tokens somados ao longo do loop (0 quando `usage` esteve ausente — fail-open). */
  tokensUsed: number;
  finalResponse: string | undefined;
}

/**
 * Return type of {@link import("../internal/local-agent/local-agent.js").LocalAgent.runUntil}.
 * Extracted so the LocalAgent method signature stays a single line (G8 LoC budget).
 *
 * @public
 */
export type RunUntilIterator = AsyncGenerator<GoalEvent, GoalResult, void>;

/**
 * Per-call configuration for `Agent.runUntil`.
 *
 * @public
 */
export interface GoalOptions {
  /** Hard cap on iterations (safety net against runaway). Default `20`. */
  maxTurns?: number;
  /**
   * M55 — token budget (Codex ext/goal parity, tool.rs:454-465). Soma `run.wait().usage.totalTokens`
   * por turno; ao cruzar, o loop para com status `budget_limited`. Omitido ⇒ ilimitado (só maxTurns).
   * `usage` ausente nunca estoura o budget (fail-open).
   */
  tokenBudget?: number;
  /** Bail after N consecutive judge parse failures. Default `3` (ADR D121). */
  maxConsecutiveJudgeFailures?: number;
  /** Judge model identifier. Default `"openai/gpt-4o-mini"` (ADR D119). */
  judgeModel?: string;
  /** Override env for the judge auxiliary agent. Default `OPENROUTER_API_KEY` (EC-A). */
  judgeApiKey?: string;
  /**
   * M80 — o modelo do agente CONDUZIDO, base da derivação do judge quando `judgeModel` é omitido.
   *
   * Existe porque o default fixo (`openai/gpt-4o-mini`) só resolve em OpenRouter: com chave
   * Anthropic dá 404, com bearer OAuth dá 401, e o goal queimava 3 turnos antes de falhar com razão
   * enganosa. Um judge que roda no mesmo modelo do chat funciona onde o chat funciona.
   */
  agentModel?: string;
  /** Optional subgoals fed to the judge prompt. */
  subgoals?: string[];
  /**
   * Cancel mid-loop via `AbortController.signal`. The generator yields
   * a `status_change: paused` event and returns at the next turn
   * boundary (ADR D117).
   */
  signal?: AbortSignal;
}
