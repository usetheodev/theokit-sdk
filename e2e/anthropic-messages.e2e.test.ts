import { Agent } from "@theokit/sdk";
import { assistantText } from "@theokit/sdk/messages";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

/**
 * The second apiMode. 41 of the catalog's 43 providers speak `chat_completions`, which the
 * agent-over-socket suite already drives; `anthropic_messages` is the other live one, and it
 * differs precisely in the body it sends. A test that only checked "a reply arrived" would
 * pass even if the SDK sent the wrong shape — the defect class B-049 recorded.
 *
 * **This file points the SDK with `ANTHROPIC_API_BASE_URL`, not with `model.url`, and the reason
 * is a defect this suite found: B-150.** The `anthropic_messages` branch (`router.ts:423`) reads
 * only the env var and `profile.baseUrl`; `model.url` never reaches it, so a run aimed at
 * localhost silently goes to the vendor. Measured: the local server recorded 0 requests and the
 * run failed with `Anthropic API error: auth_failed (HTTP 401)` — from `api.anthropic.com`.
 *
 * Using the env var here is not weakening the assertion: the shape being pinned is the request
 * body, and the env var is the seam that exists today. The regression test for `model.url`
 * belongs to B-150, written RED against the fix.
 */

const PROMPT = "ping over anthropic messages";
const REPLY = "pong from the anthropic surface";

let server: AimockServer;

let previousBaseUrl: string | undefined;

beforeAll(async () => {
  assertBuiltPackageResolves();
  server = await AimockServer.start(REPLY);
  previousBaseUrl = process.env.ANTHROPIC_API_BASE_URL;
  // Host-only, no `/v1`: AnthropicClient appends its own `/v1/messages`. Passing `${url}/v1`
  // produced `/v1/v1/messages` and a 404 with zero requests recorded — measured, not guessed.
  process.env.ANTHROPIC_API_BASE_URL = server.url;
});

afterAll(async () => {
  // Restored rather than deleted: clobbering a var the surrounding process set would leak this
  // file's setup into whatever runs next.
  if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
  else process.env.ANTHROPIC_API_BASE_URL = previousBaseUrl;
  await server?.stop();
});

it("sends the anthropic_messages body shape, not the chat_completions one", async () => {
  const agent = await Agent.create({
    apiKey: "sk-ant-e2e-aimock-local-only",
    // No `url` here — see the file docblock and B-150: this apiMode ignores it.
    model: { id: "anthropic/claude-3-5-sonnet-latest" },
    local: { cwd: process.cwd() },
  });

  const run = await agent.send(PROMPT);
  let text = "";
  for await (const event of run.stream()) text += assistantText(event);

  expect(text).toContain(REPLY);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.path).toBe("/v1/messages");
  expect(server.requests[0]?.body?.messages?.[0]?.content).toBe(PROMPT);
});
