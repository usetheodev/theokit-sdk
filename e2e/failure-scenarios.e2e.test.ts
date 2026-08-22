import { Agent } from "@theokit/sdk";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AimockServer } from "./aimock-server.js";
import { assertBuiltPackageResolves } from "./built-package-guard.js";

/**
 * The negative half of the suite. `testing.md` § 4.1 asks for both lenses; a suite that only
 * proves the happy path proves the SDK works when nothing goes wrong, which is not the
 * question anyone has in production.
 *
 * These assert the SPECIFIC report the SDK produces, never merely "something went wrong".
 * The SDK reports transport failure through a terminal `status` event rather than by
 * rejecting the stream — that is the contract these tests pin.
 */

interface StatusEvent {
  readonly type?: string;
  readonly status?: string;
  readonly message?: string;
}

async function drainToTerminalStatus(run: {
  stream: () => AsyncIterable<unknown>;
}): Promise<StatusEvent | undefined> {
  let last: StatusEvent | undefined;
  for await (const event of run.stream()) {
    const e = event as StatusEvent;
    if (e.type === "status") last = e;
  }
  return last;
}

let server: AimockServer;

beforeAll(async () => {
  assertBuiltPackageResolves();
  server = await AimockServer.start("unused");
});

afterAll(async () => {
  await server?.stop();
});

it("an unreachable endpoint reports ERROR naming the provider and the path it tried", async () => {
  // Port 1 is reserved and never listening, so the connection is refused rather than slow.
  const agent = await Agent.create({
    apiKey: "sk-e2e-aimock-local-only",
    model: { id: "openai/gpt-4o-mini", url: "http://127.0.0.1:1/v1" },
    local: { cwd: process.cwd() },
  });

  const status = await drainToTerminalStatus(await agent.send("nobody is listening"));

  expect(status?.status).toBe("ERROR");
  // Naming the provider and the path is what lets an operator tell a wrong URL from a
  // dead server without a debugger (`error-handling.md` § 2).
  expect(status?.message).toContain("openai");
  expect(status?.message).toContain("/v1/chat/completions");
});

it("a transient 500 is retried against the real server, and the turn recovers", async () => {
  // Measured, not assumed: the mock records two inbound requests, so the retry crossed the
  // socket rather than being replayed from a stub. `error-handling.md` § 2 asks that a
  // recoverable external failure be retried; this is the evidence that it is.
  const retryServer = await AimockServer.start("recovered reply");
  try {
    const agent = await Agent.create({
      apiKey: "sk-e2e-aimock-local-only",
      model: { id: "openai/gpt-4o-mini", url: `${retryServer.url}/v1` },
      local: { cwd: process.cwd() },
    });
    retryServer.failNextRequest(500, "aimock injected upstream failure");

    const types: string[] = [];
    for await (const event of (await agent.send("will the sdk retry?")).stream()) {
      types.push(String((event as { type?: string }).type));
    }

    expect(types).toContain("assistant");
    expect(retryServer.requests).toHaveLength(2);
  } finally {
    await retryServer.stop();
  }
});

it("the built-package guard accepts a real build and returns its dist path", () => {
  // The accepted case, not only the rejected one: a guard whose tests only ever assert
  // refusal is untested in the direction that breaks the product (`testing.md` § 4.2).
  expect(() => assertBuiltPackageResolves()).not.toThrow();
  expect(assertBuiltPackageResolves()).toContain("/dist/");
});
