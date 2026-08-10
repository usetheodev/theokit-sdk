/**
 * T8.1 / PV#6 — safeListTools structured-log RED test.
 *
 * Plan: arch-review-fixes-2026-06-06 § Phase 8 / T8.1
 *
 * The previous implementation swallowed `client.listTools()` errors with
 * `catch { return []; }` — violating Unbreakable Rule 8 ("FAIL loud, FAIL
 * early, FAIL clear"). This test asserts that the catch path now emits a
 * structured stderr message including (a) the project tag, (b) the failing
 * server name, and (c) the underlying error message, while still returning
 * the empty-list fallback (consumers depend on it for graceful degradation).
 */
import { describe, expect, it, vi } from "vitest";
import { safeListTools } from "../../../src/internal/agent-loop/loop.js";
import type { McpClient } from "../../../src/internal/mcp/client.js";
import type { RunEvent } from "../../../src/types/run-events.js";

describe("safeListTools — silent-catch elimination (PV#6 / T8.1)", () => {
  it("emits structured stderr message including server name + error when listTools throws", async () => {
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const mockClient = {
        listTools: vi.fn().mockRejectedValue(new Error("connection refused")),
      } as unknown as McpClient;

      const result = await safeListTools(mockClient, "test-server");

      // Fallback semantics preserved
      expect(result).toEqual([]);

      // Structured stderr emission required by Unbreakable Rule 8
      const joined = stderrWrites.join("");
      expect(joined).toContain("[theokit-sdk]");
      expect(joined).toContain("test-server");
      expect(joined).toContain("connection refused");
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  it("still returns empty list when no server name is provided (back-compat)", async () => {
    const stderrWrites: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const mockClient = {
        listTools: vi.fn().mockRejectedValue(new Error("boom")),
      } as unknown as McpClient;

      const result = await safeListTools(mockClient);

      expect(result).toEqual([]);
      // Should still emit something diagnostic even without server name
      expect(stderrWrites.join("")).toContain("[theokit-sdk]");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});

describe("theokit#188 — a failed MCP server reaches the consumer, not only stderr", () => {
  it("emits mcp_server_failed with the server name and the reason", async () => {
    const events: RunEvent[] = [];
    const broken: McpClient = {
      initialize: async () => {},
      listTools: async () => {
        throw new Error("spawn theo-mcp ENOENT");
      },
      callTool: async () => ({ content: [] }),
      close: async () => {},
    } as unknown as McpClient;

    const tools = await safeListTools(broken, "theo-mcp", (e) => events.push(e));

    expect(tools).toEqual([]);
    expect(events).toEqual([
      {
        type: "mcp_server_failed",
        serverName: "theo-mcp",
        message: "spawn theo-mcp ENOENT",
      },
    ]);
  });

  it("stays silent when no sink is attached — the sink is opt-in", async () => {
    const broken = {
      listTools: async () => {
        throw new Error("boom");
      },
    } as unknown as McpClient;
    await expect(safeListTools(broken, "s")).resolves.toEqual([]);
  });
});
