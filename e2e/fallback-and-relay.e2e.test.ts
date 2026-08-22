import { Agent } from "@theokit/sdk";
import { assistantText } from "@theokit/sdk/messages";
import { expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { AlwaysFailingServer } from "./always-failing-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

/**
 * `stream-relay.ts` is imported by `fallback-client.ts` and `pool-aware-client.ts`, and
 * `real-local-run.ts:246` builds a `FallbackLlmClient` whenever the resolved chain has more
 * than one entry. Measured before writing this: **zero** test files in the repository mention
 * `stream-relay` at all. It is not mock-tested — it is untested, and it sits on the public path.
 *
 * **Each provider is pointed with its own env var, deliberately, and not with `model.url`.**
 * `model.url` is passed to every client in the chain (`router.ts:121` hands the same
 * `routerOptions.baseUrl` to each `selectTransport`), so a fallback inherits the primary's
 * endpoint and can never reach its own. Measured: with `model.url` set, the primary received 6
 * requests and the fallback received 0. Filed as B-151.
 *
 * Both provider keys must be present or the provider is dropped from the chain before any
 * failover can happen — measured too: without `OPENAI_API_KEY`, the primary was never tried
 * (0 requests) and the run went straight to the fallback, which looks like a pass and proves
 * nothing.
 */

const FALLBACK_REPLY = "pong from the fallback provider";

interface EnvPatch {
  readonly key: string;
  readonly previous: string | undefined;
}

function setEnv(entries: Record<string, string>): EnvPatch[] {
  return Object.entries(entries).map(([key, value]) => {
    const previous = process.env[key];
    process.env[key] = value;
    return { key, previous };
  });
}

function restoreEnv(patches: EnvPatch[]): void {
  for (const { key, previous } of patches) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

it("tries the primary, then relays the fallback's stream when the primary refuses", async () => {
  assertBuiltPackageResolves();
  const primary = await AlwaysFailingServer.start(503);
  const fallback = await AimockServer.start(FALLBACK_REPLY);
  const patches = setEnv({
    OPENAI_API_BASE_URL: `${primary.url}/v1`,
    OPENROUTER_API_BASE_URL: `${fallback.url}/v1`,
    OPENAI_API_KEY: "sk-e2e-aimock-local-only",
    OPENROUTER_API_KEY: "sk-or-e2e-aimock-local-only",
    THEOKIT_API_KEY: "sk-e2e-aimock-local-only",
  });

  try {
    const agent = await Agent.create({
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: process.cwd() },
      // `routes` is required by ProviderRoutingSettings even when empty: routing here is by the
      // model id's prefix, and the fallback list is what this test exercises. The runtime accepted
      // the object without it; `tsc` did not, which is the gate doing its job.
      providers: { routes: [], fallback: ["openrouter"] },
    });

    let text = "";
    for await (const event of (await agent.send("the primary will refuse this")).stream()) {
      text += assistantText(event);
    }

    // All three matter. The primary having been tried is what makes this a failover rather
    // than a single call; the fallback having answered is what makes it a recovery; and the
    // text coming from the fallback's own configured reply is what proves the relay carried
    // the second stream rather than an empty one.
    expect(primary.received.length).toBeGreaterThanOrEqual(1);
    expect(fallback.requests).toHaveLength(1);
    expect(text).toContain(FALLBACK_REPLY);
  } finally {
    restoreEnv(patches);
    await primary.stop();
    await fallback.stop();
  }
});
