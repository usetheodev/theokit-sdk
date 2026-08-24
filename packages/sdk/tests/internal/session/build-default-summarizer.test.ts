import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * B-016 — regression cover for the provider-resolution fixes that shipped WITHOUT a test.
 *
 * Three of the four landed on `buildDefaultSummarizer`:
 *   - 643af0cc — the explicit credential outranks the model prefix, and the aggregator route passes
 *     the agent's full slug through UNSTRIPPED;
 *   - 94ddd64e — with no explicit key the ENV-detected provider wins, not the bare model prefix;
 *   - e8dc12a5 — a prefix profile only wins when its credentials are actually RESOLVABLE here.
 *
 * `resolveSummarizerRoute` (the pure fn extracted later) is already covered in `auto-compact.test.ts`
 * — but only ever with `prefixHasProfile` supplied as a LITERAL. The composed function that actually
 * runs DERIVES that flag from `process.env` plus the provider registry, and was measured at 0%
 * (lcov `DA:190`-`DA:246` all count 0). These tests drive the composition end to end and observe the
 * two decisions it makes: which provider the router is asked for, and which model is summarized with.
 */

const h = vi.hoisted(() => ({
  chainCalls: [] as Array<{ primary: string; apiKeys?: Record<string, string[]> }>,
  compressCalls: [] as Array<{ model: string }>,
}));

vi.mock("../../../src/internal/llm/router.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/internal/llm/router.js")>();
  return {
    ...actual,
    resolveProviderChain: (o: { primary: string; apiKeys?: Record<string, string[]> }) => {
      h.chainCalls.push(o);
      return [
        {
          stream: async function* () {
            yield { type: "text_delta", text: "SUMMARY" };
          },
        },
      ];
    },
  };
});

vi.mock(
  "../../../src/internal/runtime/compression/compression-summarizer.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/internal/runtime/compression/compression-summarizer.js")
      >();
    return {
      ...actual,
      compressConversationWindow: async (o: {
        model: string;
        callLlm: (m: string, system: string, user: string) => Promise<string>;
      }) => {
        h.compressCalls.push({ model: o.model });
        // Drive the real `callLlm` closure so the router sees the resolved provider.
        const content = await o.callLlm(o.model, "system", "user");
        return { content };
      },
    };
  },
);

/** Set the three keys `detectPrimaryProvider` scans, plus GROQ. "" reads as absent everywhere. */
function env(vars: { anthropic?: string; openai?: string; openrouter?: string; groq?: string }) {
  vi.stubEnv("ANTHROPIC_API_KEY", vars.anthropic ?? "");
  vi.stubEnv("OPENAI_API_KEY", vars.openai ?? "");
  vi.stubEnv("OPENROUTER_API_KEY", vars.openrouter ?? "");
  vi.stubEnv("GROQ_API_KEY", vars.groq ?? "");
}

/** Run the summarizer and report the two decisions it made. */
async function route(opts: {
  agentModel: string;
  apiKey?: string;
}): Promise<{ provider: string; model: string; apiKeys: Record<string, string[]> | undefined }> {
  h.chainCalls.length = 0;
  h.compressCalls.length = 0;
  const { buildDefaultSummarizer } = await import(
    "../../../src/internal/session/compact-session.js"
  );
  const summarize = buildDefaultSummarizer(opts);
  await summarize([{ role: "user", content: "hello" }]);
  const chain = h.chainCalls[0];
  const compress = h.compressCalls[0];
  if (chain === undefined || compress === undefined) {
    throw new Error("summarizer did not reach the router / compression window");
  }
  return { provider: chain.primary, model: compress.model, apiKeys: chain.apiKeys };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildDefaultSummarizer — 643af0cc: an explicit key outranks the model prefix", () => {
  it("sk-or- key with an openai/ model summarizes via openrouter, slug unstripped", async () => {
    // OPENAI_API_KEY is present, so the `openai` prefix profile IS usable — the key must still win.
    env({ openai: "sk-openai-env" });

    const r = await route({ agentModel: "openai/gpt-4o", apiKey: "sk-or-v1-b016" });

    expect(r.provider).toBe("openrouter");
    // Aggregator route: the agent's own slug passes through, NOT the registry's "openai/gpt-4o-mini".
    expect(r.model).toBe("openai/gpt-4o");
    expect(r.apiKeys).toEqual({ openrouter: ["sk-or-v1-b016"] });
  });
});

describe("buildDefaultSummarizer — 94ddd64e/e8dc12a5: an unusable prefix profile must not win", () => {
  it("openai/ model with only OPENROUTER_API_KEY set routes to openrouter, not openai", async () => {
    env({ openrouter: "sk-or-env" });

    const r = await route({ agentModel: "openai/gpt-4o" });

    expect(r.provider).toBe("openrouter");
    expect(r.model).toBe("openai/gpt-4o");
  });

  // rules/testing.md § 4.2 — the ACCEPTED case is half the oracle. Without this pair a
  // `prefixUsable` forced to `false` (or deleted outright) still satisfies the rejection test above.
  it("groq/ model WITH GROQ_API_KEY set lets the prefix profile win over the env provider", async () => {
    env({ groq: "gsk-groq-env", openrouter: "sk-or-env" });

    const r = await route({ agentModel: "groq/llama-3.3-70b-versatile" });

    expect(r.provider).toBe("groq");
  });

  it("groq/ model WITHOUT GROQ_API_KEY falls back to the env-detected provider", async () => {
    env({ openrouter: "sk-or-env" });

    const r = await route({ agentModel: "groq/llama-3.3-70b-versatile" });

    expect(r.provider).toBe("openrouter");
  });
});

describe("buildDefaultSummarizer — compression-registry resolution on the direct route", () => {
  it("a registered model summarizes with the registry's compression model", async () => {
    env({ openai: "sk-openai-env" });

    const r = await route({ agentModel: "openai/gpt-4o" });

    expect(r.provider).toBe("openai");
    expect(r.model).toBe("openai/gpt-4o-mini");
  });

  it("a registry MISS falls back to the agent's own model instead of throwing", async () => {
    env({ openai: "sk-openai-env" });

    const r = await route({ agentModel: "openai/gpt-4o-unregistered-b016" });

    expect(r.provider).toBe("openai");
    expect(r.model).toBe("openai/gpt-4o-unregistered-b016");
  });
});
