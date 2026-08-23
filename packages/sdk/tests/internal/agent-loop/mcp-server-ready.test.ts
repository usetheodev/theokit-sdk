/**
 * A consumer can see what each MCP server DELIVERED, not only that one failed
 * (usetheokit/theokit#426).
 *
 * ## The gap
 *
 * `mcp_server_failed` already reaches the consumer, so a broken server is visible. A server that
 * came up is not: the resolved tool table lives in `loop-context-init.ts` and never leaves
 * `internal/`, and no member of the public `RunEvent` union carries an inventory.
 *
 * So a `/mcp`-style command could list what is CONFIGURED and what BROKE, and could not tell a
 * server that came up with twelve tools from one that came up with none — which is the case an
 * operator opens the command to find.
 *
 * ## Why an event and not a getter
 *
 * `mcpLifecycle: "run"` means a server may not exist by the time anyone asks, so a getter would have
 * to answer about something already gone. An event says what was true when the run started, which
 * is the only honest answer for state scoped to a run. It is also symmetric with the failure that
 * already ships from the same function.
 */
import { describe, expect, it, vi } from "vitest";
import { safeListTools } from "../../../src/internal/agent-loop/loop.js";
import type { McpClient } from "../../../src/internal/mcp/client.js";
import type { RunEvent } from "../../../src/types/run-events.js";

/** `RunEventSink` is a FUNCTION, not an object with a handler — measured, not assumed. */
function sink() {
  const events: RunEvent[] = [];
  const fn = (e: RunEvent) => {
    events.push(e);
  };
  return { events, fn };
}

function clientListing(names: string[]): McpClient {
  return {
    listTools: vi.fn().mockResolvedValue(names.map((name) => ({ name, description: name }))),
  } as unknown as McpClient;
}

describe("a server that listed its tools says so", () => {
  it("emits mcp_server_ready naming the server and every tool it exposed", async () => {
    const s = sink();

    await safeListTools(clientListing(["search", "fetch"]), "github", s.fn);

    const ready = s.events.find((e) => e.type === "mcp_server_ready");
    expect(ready).toBeDefined();
    expect(ready).toMatchObject({ serverName: "github", tools: ["search", "fetch"] });
  });

  it("emits it for a server that came up with NO tools", async () => {
    const s = sink();

    await safeListTools(clientListing([]), "empty-server", s.fn);

    // The case the issue names: today this is indistinguishable from a server that failed, because
    // both produce an empty tool list and only the failure is announced.
    expect(s.events.find((e) => e.type === "mcp_server_ready")).toMatchObject({
      serverName: "empty-server",
      tools: [],
    });
  });
});

describe("a server that failed does NOT also report ready", () => {
  it("emits only mcp_server_failed when listTools throws", async () => {
    const s = sink();

    await safeListTools(
      {
        listTools: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as unknown as McpClient,
      "broken",
      s.fn,
    );

    expect(s.events.map((e) => e.type)).toEqual(["mcp_server_failed"]);
  });
});

describe("the event carries a name a consumer can match", () => {
  it("uses the CONFIGURED server name, not a sanitized tool prefix", async () => {
    const s = sink();

    // Tool names are prefixed `mcp_<sanitized>_<tool>` for the model. The EVENT must carry the name
    // as written in the MCP configuration, or a consumer cannot match it to the row it already shows.
    await safeListTools(clientListing(["do"]), "my server.v2", s.fn);

    expect(s.events.find((e) => e.type === "mcp_server_ready")).toMatchObject({
      serverName: "my server.v2",
    });
  });

  it("says nothing when no sink is listening", async () => {
    // The sink is optional; a run without one must not pay for events nobody reads.
    await expect(safeListTools(clientListing(["do"]), "github")).resolves.toHaveLength(1);
  });
});
