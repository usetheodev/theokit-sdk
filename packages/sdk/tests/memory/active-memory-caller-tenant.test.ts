import { describe, expect, it } from "vitest";

import type { AgentOptions } from "../../src/types/agent.js";
import { LocalAgentMemory } from "../../src/internal/runtime/local-agent/local-agent-memory.js";

/**
 * #56 (GAP-A) — the production caller must thread the tenant partition into the
 * active-recall args, not hardcode `namespace: "default"`. Otherwise two tenants
 * sharing a `userId` but differing on `memoryContext.tenantId` collide on one
 * cache entry (the isolation only lives in the primitive; the caller must feed
 * it a real tenant discriminator).
 *
 * `namespace` is documented as the tenant/org partition (`e.g. default, <orgId>`),
 * so `memoryContext.tenantId` maps onto it.
 */
type RecallArgs = { namespace: string; scope: string; userId?: string };
const buildArgs = (mem: LocalAgentMemory): RecallArgs =>
  (mem as unknown as { buildTelemetryRecallArgs(): RecallArgs }).buildTelemetryRecallArgs();

describe("active-recall caller threads tenant identity (#56-A)", () => {
  it("maps memoryContext.tenantId onto the cache-key namespace", () => {
    const opts = { memoryContext: { userId: "u", tenantId: "org-X" } } as AgentOptions;
    const mem = new LocalAgentMemory(opts, "/tmp/ws", "agent-1");
    const args = buildArgs(mem);
    expect(args.namespace).toBe("org-X");
    expect(args.userId).toBe("u");
  });

  it("two tenants sharing a userId get DIFFERENT namespaces (no collision)", () => {
    const a = new LocalAgentMemory({ memoryContext: { userId: "u", tenantId: "org-A" } } as AgentOptions, "/tmp", "a");
    const b = new LocalAgentMemory({ memoryContext: { userId: "u", tenantId: "org-B" } } as AgentOptions, "/tmp", "b");
    expect(buildArgs(a).namespace).not.toBe(buildArgs(b).namespace);
  });

  it("falls back to 'default' namespace when no tenantId is set", () => {
    const mem = new LocalAgentMemory({ memoryContext: { userId: "u" } } as AgentOptions, "/tmp", "a");
    expect(buildArgs(mem).namespace).toBe("default");
  });
});
