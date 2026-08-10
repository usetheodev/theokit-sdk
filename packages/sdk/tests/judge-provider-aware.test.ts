/**
 * M80 T1.1 — the judge stops being provider-blind, and fails fast when the credential does not work.
 *
 * ## The measured cost, documented by the consumer itself
 *
 * `judge-call.ts` reads **only** `OPENROUTER_API_KEY` (*"EC-A: single env source — OpenRouter only"*) and
 * pins `openai/gpt-4o-mini`. The agent-builder already wrote down the price, in `agents/lib/goal/goal.ts`:
 *
 * > *"The SDK's default judge (`openai/gpt-4o-mini`) only resolves on OpenRouter; with an Anthropic
 * > key it 404s and with an OAuth bearer it 401s — every goal then burns 3 full turns before
 * > 'failed' with a misleading reason."*
 *
 * It worked around this by deriving the model itself. The knowledge is in the wrong place: who knows
 * which judge resolves for which credential is the judge subsystem, not each consumer.
 *
 * ## Why 401/404 fail fast and a malformed parse does NOT
 *
 * They are errors of different kinds (`rules/error-handling.md` § 2). A nonexistent model does not improve
 * on retry — burning 3 turns before giving up is waste with a diagnostic worse than the error. A
 * non-parseable verdict **is** recoverable: the loop decides on consecutive failures, a policy
 * documented at `judge-call.ts:44-48`, and aborting on it would break goals that work today.
 *
 * ## A correction to this milestone's blueprint
 *
 * The blueprint concluded that `blocked` "is already in the vocabulary" — true for
 * `GoalResult.status` (`types/goal-events.ts:60`) and **false** for the judge's verdict, which is
 * `"done" | "continue" | "skipped"`. I read half the DoD and declared the other half done. The test
 * below covers the half that was missing.
 */
import { describe, expect, it } from "vitest";

import { TheokitAgentError } from "../src/errors.js";
import type { JudgeContext } from "../src/internal/judge/judge-call.js";
import { judgeCallImpl } from "../src/internal/judge/judge-call.js";

const ctx = { goal: "do X", lastResponse: "did X", turnsUsed: 1 } as unknown as JudgeContext;

/** Fake agent: records the requested model and returns the configured text (or throws). */
function fakeAgent(behavior: { text?: string; error?: Error }) {
  const models: string[] = [];
  const keys: (string | undefined)[] = [];
  return {
    models,
    keys,
    deps: {
      create: async (options: { model?: { id?: string }; apiKey?: string }) => {
        models.push(options.model?.id ?? "(no model)");
        keys.push(options.apiKey);
        return {
          send: async () => {
            if (behavior.error !== undefined) throw behavior.error;
            return { wait: async () => ({ result: behavior.text ?? "" }) };
          },
          dispose: async () => undefined,
        };
      },
    } as never,
  };
}

describe("M80 T1.1 — judge provider-aware", () => {
  it("test_the_judge_derives_the_model_from_the_agent_it_drives", async () => {
    const a = fakeAgent({ text: "DONE: pronto" });
    await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "anthropic/claude-4" }, a.deps);

    expect(
      a.models[0],
      "without an explicit `judgeModel`, the judge must follow the driven agent's model — " +
        "the fixed default only resolves on OpenRouter",
    ).toBe("anthropic/claude-4");
  });

  it("test_an_explicit_judgeModel_BEATS_the_derivation", () => {
    // COUNTER-PROOF: the derivation is the DEFAULT, not an imposition. M64's A/B showed the cheap judge
    // winning on short goals, and whoever knows that must be able to say so.
    const a = fakeAgent({ text: "DONE: pronto" });
    return judgeCallImpl(
      ctx,
      { apiKey: "sk-x", agentModel: "anthropic/claude-4", judgeModel: "openai/gpt-4o-mini" },
      a.deps,
    ).then(() => {
      expect(a.models[0]).toBe("openai/gpt-4o-mini");
    });
  });

  it("test_a_401_throws_a_TYPED_error_and_does_not_fold_into_parseFailed", async () => {
    // The case that today burns 3 turns: the credential does not work for the judge, and the loop treats it as
    // "continue" three times before giving up with a misleading reason.
    const a = fakeAgent({ error: Object.assign(new Error("401 Unauthorized"), { status: 401 }) });

    await expect(
      judgeCallImpl(ctx, { apiKey: "sk-bad", agentModel: "m" }, a.deps),
    ).rejects.toBeInstanceOf(TheokitAgentError);
  });

  it("test_a_model_404_throws_a_TYPED_error", async () => {
    const a = fakeAgent({
      error: Object.assign(new Error("404 model not found"), { status: 404 }),
    });

    await expect(
      judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "nonexistent/model" }, a.deps),
    ).rejects.toBeInstanceOf(TheokitAgentError);
  });

  it("test_COUNTERPROOF_a_PARSE_failure_stays_folded", async () => {
    // The half that must NOT become fail-fast. A non-parseable verdict is recoverable — the loop decides
    // on consecutive failures (`judge-call.ts:44-48`), and aborting on it would break working goals.
    const a = fakeAgent({ text: "text that starts with no canonical prefix" });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.parseFailed).toBe(true);
    expect(r.verdict).toBe("continue");
  });

  it("test_COUNTERPROOF_a_NETWORK_error_also_stays_folded", async () => {
    // Without this, "fail fast on error" would become fail fast on EVERYTHING. A network timeout is transient; the
    // loop must be able to retry, as it always could.
    const a = fakeAgent({ error: new Error("ETIMEDOUT") });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.parseFailed).toBe(true);
  });

  it("test_blocked_joins_the_VERDICT_vocabulary", async () => {
    // The half of DoD 3 this milestone's blueprint mistakenly declared done: `blocked` already
    // existed on `GoalResult.status`, but the judge's verdict was `done | continue | skipped`. Without
    // it, the judge has no way to say "impossible to proceed" — only "continue", which the loop repeats.
    const a = fakeAgent({ text: "BLOCKED: the same blocker recurred" });
    const r = await judgeCallImpl(ctx, { apiKey: "sk-x", agentModel: "m" }, a.deps);

    expect(r.verdict).toBe("blocked");
    expect(r.parseFailed, "`blocked` is a legitimate verdict, not a parse failure").toBe(false);
  });
});
