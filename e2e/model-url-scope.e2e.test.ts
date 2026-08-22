import { Agent } from "@theokit/sdk";
import { assistantText } from "@theokit/sdk/messages";
import { expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { AlwaysFailingServer } from "./always-failing-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

/**
 * B-151. `ModelSelection.url` is documented at `router.ts:51-58` as *"the endpoint THIS call
 * should reach"*, and as deliberately outranking the process-wide env var — the docblock's own
 * words are that a process-wide setting would otherwise "keep hijacking every other one, which is
 * the bug this field exists to end".
 *
 * Inside a fallback chain the hijack was still there, performed by the per-call field instead:
 * `resolveProviderChain` handed one `baseUrl` to every client it built, so a fallback provider
 * inherited the primary's endpoint and could never reach its own.
 *
 * Measured before the fix, same two servers: with `model.url` set, the primary received 6 requests
 * and the fallback 0; pointing each provider with its own `*_API_BASE_URL` instead gave 3 and 1.
 */

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

it("scopes model.url to the provider the model id names, not to the whole chain", async () => {
  assertBuiltPackageResolves();
  const primary = await AlwaysFailingServer.start(503);
  const fallback = await AimockServer.start("pong from the fallback provider");
  const patches = setEnv({
    // The fallback provider is pointed by ITS OWN env var. Only `model.url` names the primary.
    OPENROUTER_API_BASE_URL: `${fallback.url}/v1`,
    OPENAI_API_KEY: "sk-e2e-aimock-local-only",
    OPENROUTER_API_KEY: "sk-or-e2e-aimock-local-only",
    THEOKIT_API_KEY: "sk-e2e-aimock-local-only",
  });

  try {
    const agent = await Agent.create({
      // `url` names where THIS model lives. It must not follow the chain past it.
      model: { id: "openai/gpt-4o-mini", url: `${primary.url}/v1` },
      local: { cwd: process.cwd() },
      providers: { routes: [], fallback: ["openrouter"] },
    });

    let text = "";
    for await (const event of (await agent.send("the primary will refuse this")).stream()) {
      text += assistantText(event);
    }

    expect(primary.received.length).toBeGreaterThanOrEqual(1);
    // The assertion that fails before the fix: the fallback never saw a request, because
    // `model.url` had redirected it back to the primary's host.
    expect(fallback.requests.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain("pong from the fallback provider");
  } finally {
    restoreEnv(patches);
    await primary.stop();
    await fallback.stop();
  }
});
