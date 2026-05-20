# Judge Call Pattern

> Para loops autônomos (Ralph, autonomous skills, curator), use um
> **auxiliary LLM como judge** — modelo separado (geralmente mais
> barato/rápido) que avalia "está pronto?" depois de cada turn. Sem
> judge, loops ou rodam até budget esgotar ou param prematuramente. Com
> judge: feedback loop fechado, terminação determinística. Hermes
> implementa em 3 lugares (goal judge, curator review, kanban hallucination
> gate).

## Quando aplicar

Aplique quando o SDK tem loop com critério de parada externo:

- `Agent.runUntil(goal)` — "is the goal satisfied?"
- `Skills.curator()` — "should I archive this skill?"
- `Memory.consolidate()` — "are these memories consolidated enough?"
- Hallucination gate — "did the agent actually do what it claimed?"

Não aplique quando:

- Loop tem critério OBJETIVO (budget exhausted, test passes, file exists)
- Decision é determinística sem LLM (`if x > threshold`)
- Custo do judge > custo do trabalho

## Por que importa

Sem judge, agentes autônomos sofrem 2 failure modes:

1. **Looping forever**: agent diz "let me try again", tenta de novo, repeat.
   Sem judge externo, agent não tem self-awareness para parar.

2. **Stopping too early**: agent diz "I think I'm done" mas verdade não está.
   User decepcionado.

Judge externo arbitra. Como external observer, agnóstico ao agent's
own narrative. Hermes' `/goal` ships com configurable judge model
(default = same as main, mas docs recomendam Haiku ou GPT-4o-mini).

## Pattern canonical (Python — Hermes goals.py)

```python
# hermes_cli/goals.py (approximate)
async def judge_goal(
    self,
    goal: str,
    last_response: str,
    subgoals: list[str],
) -> tuple[Verdict, str, bool]:
    """Ask the judge model whether the goal is satisfied."""
    
    prompt = f"""You are a goal judge. Determine if this goal is satisfied.

Goal: {goal}
Subgoals: {", ".join(subgoals) if subgoals else "(none)"}
Last agent response: {last_response}

Respond with EXACTLY one of:
- DONE: <reason>
- CONTINUE: <what's left>
- SKIPPED: <why not applicable>

Be strict. If unclear, prefer CONTINUE."""

    response = await self.auxiliary_client.complete(
        model=self.judge_model,  # diferent from main
        messages=[{"role": "user", "content": prompt}],
        max_tokens=200,
        temperature=0,  # deterministic
    )
    
    # Parse the verdict
    text = response.content.strip()
    if text.startswith("DONE:"):
        return ("done", text[5:].strip(), False)
    elif text.startswith("CONTINUE:"):
        return ("continue", text[9:].strip(), False)
    elif text.startswith("SKIPPED:"):
        return ("skipped", text[8:].strip(), False)
    
    # Parse failed — judge gave malformed response
    return ("continue", "parse failed", True)  # fail-safe: continue
```

## TypeScript equivalent

```typescript
// packages/sdk/src/internal/judge/judge-call.ts
export type Verdict = "done" | "continue" | "skipped";

export interface JudgeResult {
  verdict: Verdict;
  reason: string;
  parseFailed: boolean; // true se response malformed
}

interface JudgeOptions {
  judgeModel?: string; // default: parent model
  judgeProvider?: string;
  maxTokens?: number;
  temperature?: number;
}

export async function judgeCall(
  prompt: string,
  context: {
    goal: string;
    lastResponse: string;
    subgoals?: string[];
  },
  options?: JudgeOptions,
): Promise<JudgeResult> {
  const judgePrompt = composeJudgePrompt(context);
  
  // Use auxiliary client (cheaper model possibly)
  const auxAgent = await Agent.create({
    apiKey: process.env.OPENAI_API_KEY,
    model: { id: options?.judgeModel ?? "openai/gpt-4o-mini" },
    temperature: 0,
    maxIterations: 1, // single shot — no tools
    tools: [],
    metadata: { role: "judge" },
  });
  
  try {
    const run = await auxAgent.send(judgePrompt);
    const result = await run.wait();
    return parseVerdict(result.result ?? "");
  } finally {
    await auxAgent.dispose();
  }
}

function composeJudgePrompt(ctx: {
  goal: string;
  lastResponse: string;
  subgoals?: string[];
}): string {
  const subgoals = ctx.subgoals?.length ? ctx.subgoals.join(", ") : "(none)";
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

function parseVerdict(text: string): JudgeResult {
  const trimmed = text.trim();
  
  if (trimmed.startsWith("DONE:")) {
    return { verdict: "done", reason: trimmed.slice(5).trim(), parseFailed: false };
  }
  if (trimmed.startsWith("CONTINUE:")) {
    return { verdict: "continue", reason: trimmed.slice(9).trim(), parseFailed: false };
  }
  if (trimmed.startsWith("SKIPPED:")) {
    return { verdict: "skipped", reason: trimmed.slice(8).trim(), parseFailed: false };
  }
  
  // Parse failed — fail-safe: continue
  return {
    verdict: "continue",
    reason: `judge response malformed: "${trimmed.slice(0, 100)}"`,
    parseFailed: true,
  };
}
```

## Pattern: consecutive parse failure detection

Weak judge models (GPT-3.5, Haiku) sometimes return free-form prose
instead of `DONE:/CONTINUE:/SKIPPED:`. Sem detection, parseFail = continue
→ infinite loop.

```typescript
// packages/sdk/src/agent.ts (runUntil)
async *runUntil(goal: string, options?: GoalOptions): AsyncIterable<GoalEvent> {
  const maxConsecutiveFailures = options?.maxConsecutiveJudgeFailures ?? 3;
  let consecutiveFailures = 0;
  
  while (turn < maxTurns) {
    const response = await this.send(continuation);
    const judgment = await judgeCall(goal, response, lastResponse);
    
    if (judgment.parseFailed) {
      consecutiveFailures += 1;
      yield {
        type: "judge_verdict",
        turn,
        verdict: "continue",
        reason: `parse failed (${consecutiveFailures}/${maxConsecutiveFailures})`,
      };
      
      if (consecutiveFailures >= maxConsecutiveFailures) {
        yield {
          type: "status_change",
          status: "failed",
          reason: `judge model too unreliable (${consecutiveFailures} parse failures in a row)`,
        };
        return;
      }
    } else {
      consecutiveFailures = 0; // reset on successful parse
    }
    
    if (judgment.verdict === "done") return;
    // ... continue ...
  }
}
```

## Pattern: hallucination gate (variant)

When agent CLAIMS to have done something (created card, deleted file),
judge VERIFIES via side-effect check (not LLM-judged):

```typescript
// Kanban example
async function verifyTaskCompletion(
  agent: Agent,
  claimedTaskIds: string[],
  kanban: Kanban,
): Promise<{ verified: string[]; phantom: string[] }> {
  const verified: string[] = [];
  const phantom: string[] = [];
  
  for (const id of claimedTaskIds) {
    if (await kanban.taskExists(id)) {
      verified.push(id);
    } else {
      phantom.push(id);
    }
  }
  
  return { verified, phantom };
}

// In Kanban.completeTask:
const { phantom } = await verifyTaskCompletion(agent, claim.createdIds, kanban);
if (phantom.length > 0) {
  // Re-prompt agent: "You claimed to create [phantom] but they don't exist"
  return { ok: false, reason: "hallucinated card creation" };
}
```

This is **judge by side-effect verification**, not by LLM call. Stronger
guarantee — no model-on-model interpretation.

## Architectural decisions

### AD-1: Judge model é separate, cheaper

Default judge = main model. Override permite:
- Faster turnaround (Haiku 5x faster than Sonnet)
- Lower cost (GPT-4o-mini 1/30th the cost of GPT-4)
- Independent failure mode (judge bug ≠ main bug)

Trade-off: weaker judge = more parse failures. Tunable.

### AD-2: Verdict is enum, not free-form

Forces consistency. Parse-failure-detector counts on enum shape.

### AD-3: Fail-safe to "continue" on parse error

If parse fails, default = continue (not stop). Razão: stopping prematurely
is worse than burning extra turns (user loses work in progress vs user
burns extra API budget).

Defesa downstream: max consecutive failures → bail with "judge too
unreliable".

### AD-4: Temperature 0 for judge

Deterministic verdict for same input. Otherwise:
- Agent says X → judge says DONE
- Replay same input → judge says CONTINUE
- Non-reproducible bugs

`temperature: 0` é mandatory para judges.

## Failure modes prevenidos

1. **Infinite loop**: agent says "let me try again" forever. Judge says
   "done" or "continue" — finite states.

2. **Premature stop**: agent says "I think I'm done" but isn't. External
   judge enforces actual completion criterion.

3. **Hallucinated side effects**: agent says "created cards X,Y,Z" sem
   side effect. Side-effect judge verifies.

4. **Weak model judges**: parse-failure detector + max-consecutive cap.

## Failure modes NÃO prevenidos

- **Adversarial judge**: agent learns to produce output that judge always
  approves (without actually completing goal). Theoretical concern with
  same model as agent. Mitigation: independent judge model.

- **Judge missing context**: judge sees only last response, not full
  history. Edge cases requer more context. Mitigation: include relevant
  recent context (last 3 turns?) em judge prompt.

- **Cost overhead**: each judge call = LLM call. For 20-turn goal: 20
  judge calls. Mitigation: use cheap model.

## Como testar

```typescript
it("parses DONE verdict", () => {
  const r = parseVerdict("DONE: tests pass");
  expect(r).toEqual({ verdict: "done", reason: "tests pass", parseFailed: false });
});

it("parses CONTINUE verdict", () => {
  const r = parseVerdict("CONTINUE: need to fix the third test");
  expect(r.verdict).toBe("continue");
  expect(r.reason).toBe("need to fix the third test");
});

it("returns parseFailed for malformed response", () => {
  const r = parseVerdict("I think we're getting there.");
  expect(r.parseFailed).toBe(true);
  expect(r.verdict).toBe("continue"); // fail-safe
});

it("max consecutive parse failures bail out", async () => {
  // Mock judge to always return malformed
  vi.spyOn(judge, "call").mockResolvedValue({
    verdict: "continue", reason: "...", parseFailed: true,
  });
  
  const events: GoalEvent[] = [];
  for await (const e of agent.runUntil("goal", { maxConsecutiveJudgeFailures: 3 })) {
    events.push(e);
  }
  
  const final = events.at(-1);
  expect(final).toMatchObject({
    type: "status_change",
    status: "failed",
    reason: expect.stringMatching(/parse failures/),
  });
});

it("side-effect verification catches phantom claims", async () => {
  const kanban = new MockKanban();
  kanban.tasks = ["real-1", "real-2"]; // claim says created real-1, real-2, phantom-3
  
  const result = await verifyTaskCompletion(
    fakeAgent,
    ["real-1", "real-2", "phantom-3"],
    kanban,
  );
  
  expect(result.verified).toEqual(["real-1", "real-2"]);
  expect(result.phantom).toEqual(["phantom-3"]);
});
```

## Onde wirar no SDK

`packages/sdk/src/internal/judge/`:

- `judge-call.ts` — `judgeCall`, `parseVerdict`, `composeJudgePrompt`
- `verify-side-effect.ts` — `verifyClaim`, `assertCreated`
- Callers: `Agent.runUntil`, `Skills.curator`, `Kanban.completeTask`

## Referências cruzadas

- [forked-agent-pattern.md](./forked-agent-pattern.md) — judge can be forked from parent
- [async-iterable-streaming.md](./async-iterable-streaming.md) — judge yields verdict events
- [tool-call-failure-recovery.md](./tool-call-failure-recovery.md) — hallucination gate variant

## Citações primárias

- `referencia/hermes-agent/hermes_cli/goals.py:580` — `evaluate_after_turn`
- `referencia/hermes-agent/hermes_cli/goals.py:judge_goal` — verdict parsing
- `.claude/knowledge-base/hermes-deep-dive/02-runUntil-goal.md:46-100` — happy path
- v0.13 #20232 — hallucination gate in kanban
