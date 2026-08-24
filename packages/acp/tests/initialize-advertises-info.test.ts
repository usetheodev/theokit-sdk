import type * as acp from "@agentclientprotocol/sdk";
import { expect, it } from "vitest";
import { buildInitializeResponse } from "../src/lifecycle.js";

/*
 * #350 — `AcpServerOptions.info` was accepted, typed, documented as "advertised in `initialize`",
 * and never read. A caller configured it, got no error, and observed no change — the worst failure
 * shape for an option, indistinguishable from a working one until someone inspects the wire.
 *
 * The protocol has the slot: `InitializeResponse.agentInfo` is an `Implementation`
 * (`{ name, title?, version }`), which is exactly the shape `AcpAgentInfo` already declares.
 *
 * Its two siblings do NOT have a slot. `AgentCapabilities` at `@agentclientprotocol/sdk@0.22.1`
 * carries `auth`, `loadSession`, `mcpCapabilities`, `nes`, `positionEncoding`, `promptCapabilities`,
 * `providers` and `sessionCapabilities` — no `forkSession`, no `listSessions`, and neither name
 * appears anywhere in the generated schema. They are removed rather than wired, because there is
 * nowhere to advertise them and neither gated anything.
 */

const REQUEST = {} as acp.InitializeRequest;

it("advertises the caller's info as agentInfo", () => {
  const response = buildInitializeResponse(REQUEST, {
    info: { name: "my-bot", title: "My Bot", version: "2.1.0" },
  });

  expect(response.agentInfo).toEqual({ name: "my-bot", title: "My Bot", version: "2.1.0" });
});

it("omits agentInfo when the caller did not supply it", () => {
  // The accepted case (`testing.md` § 4.2). Defaulting to this package's own metadata would label
  // every agent as the adapter serving it, which is worse than saying nothing: the host would
  // display a name that is confidently wrong rather than absent.
  const response = buildInitializeResponse(REQUEST, {});

  expect(response.agentInfo).toBeUndefined();
});

it("still advertises the capabilities it always did", () => {
  const response = buildInitializeResponse(REQUEST, { capabilities: { loadSession: false } });

  expect(response.agentCapabilities?.loadSession).toBe(false);
  expect(response.agentCapabilities?.promptCapabilities).toEqual({
    image: true,
    audio: false,
    embeddedContext: true,
  });
});
