import { Agent } from "@theokit/sdk";
import { assistantText } from "@theokit/sdk/messages";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

/**
 * B-150. `ModelSelection.url` is documented at `router.ts:51-58` as "the endpoint THIS call should
 * reach", and it reached only two of the four transport branches: `ollama` and `chat_completions`.
 * `anthropic_messages` read `ANTHROPIC_API_BASE_URL ?? profile.baseUrl` and never the per-call
 * field, so a run aimed at localhost went to the vendor instead.
 *
 * Measured before the fix: the local server recorded **0** requests and the run failed with
 * `Anthropic API error: auth_failed (HTTP 401)` — a 401 from api.anthropic.com, reached with the
 * caller's key, after the caller had explicitly named a different host.
 *
 * That is an egress an air-gapped or tenant-isolated operator configured against, and
 * `error-handling.md` § 2 requires a substitution like it to fail loudly rather than proceed.
 */

const PROMPT = "ping over anthropic messages";
const REPLY = "pong from the anthropic surface";

let server: AimockServer;

beforeAll(async () => {
  assertBuiltPackageResolves();
  server = await AimockServer.start(REPLY);
});

afterAll(async () => {
  await server?.stop();
});

it("honours model.url on the anthropic_messages branch", async () => {
  const agent = await Agent.create({
    apiKey: "sk-ant-e2e-aimock-local-only",
    // Host-only: AnthropicClient appends its own `/v1/messages`.
    model: { id: "anthropic/claude-3-5-sonnet-latest", url: server.url },
    local: { cwd: process.cwd() },
  });

  let text = "";
  for await (const event of (await agent.send(PROMPT)).stream()) text += assistantText(event);

  expect(text).toContain(REPLY);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.path).toBe("/v1/messages");
});
