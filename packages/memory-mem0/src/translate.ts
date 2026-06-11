/**
 * `MemoryContext` → Mem0 add/search options translation (T5.1).
 *
 * Mem0 keeps `user_id`, `agent_id`, `app_id`, `run_id` orthogonal —
 * we map each `MemoryContext` field onto its native primitive.
 *
 * @internal
 */

import type { MemoryContext } from "@theokit/sdk";

interface Mem0Options {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  app_id?: string;
  categories?: string[];
  metadata?: Record<string, unknown>;
}

export function toMem0Options(ctx: MemoryContext): Mem0Options {
  const out: Mem0Options = { user_id: ctx.userId };
  if (ctx.agentId !== undefined) out.agent_id = ctx.agentId;
  if (ctx.sessionId !== undefined) out.run_id = ctx.sessionId;
  if (ctx.tenantId !== undefined) out.app_id = ctx.tenantId;
  if (ctx.tags !== undefined) out.categories = ctx.tags;
  if (ctx.metadata !== undefined) out.metadata = ctx.metadata;
  return out;
}
