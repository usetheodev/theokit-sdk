import { Agent } from "@theokit/sdk";
import { assistantText } from "@theokit/sdk/messages";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

const PROMPT = "ping over a real socket";
const REPLY = "pong from aimock";

let server: AimockServer;

beforeAll(async () => {
  assertBuiltPackageResolves();
  server = await AimockServer.start(REPLY);
});

afterAll(async () => {
  await server?.stop();
});

it("drives the built SDK over a socket and puts the prompt on the wire", async () => {
  const agent = await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "sk-e2e-aimock-local-only",
    model: { id: "openai/gpt-4o-mini", url: `${server.url}/v1` },
    local: { cwd: process.cwd() },
  });

  const run = await agent.send(PROMPT);
  let text = "";
  for await (const event of run.stream()) text += assistantText(event);

  expect(text).toContain(REPLY);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.body?.messages?.[0]?.content).toBe(PROMPT);
});
