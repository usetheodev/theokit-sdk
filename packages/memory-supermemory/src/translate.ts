/**
 * `MemoryContext` → Supermemory containerTags translation (T3.2).
 *
 * EC-C fix: every component runs through a strict identifier sanitizer
 * (regex `^[a-zA-Z0-9_-]+$`) before being joined with `:`. Rejects with
 * `MemoryAdapterError(code: "invalid_input")` on invalid input, so a
 * value like `userId: "user:123"` cannot silently land in a different
 * bucket via tag mis-parsing.
 *
 * @internal
 */

import type { MemoryContext } from "@usetheo/sdk";
import { MemoryAdapterError } from "@usetheo/sdk";

const SAFE_IDENT = /^[a-zA-Z0-9_-]+$/;
const ADAPTER_ID = "supermemory";

export function sanitizeIdentifier(value: string, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MemoryAdapterError(`Supermemory adapter: ${fieldName} must be a non-empty string`, {
      adapterId: ADAPTER_ID,
      code: "invalid_input",
    });
  }
  if (!SAFE_IDENT.test(value)) {
    throw new MemoryAdapterError(
      `Supermemory adapter: ${fieldName} "${value}" contains invalid characters (allowed: a-zA-Z0-9_-)`,
      { adapterId: ADAPTER_ID, code: "invalid_input" },
    );
  }
  return value;
}

/**
 * Build the array of containerTags for `documents.add`. Each component
 * is sanitized; collisions across tag namespaces (user/agent/tenant/tag)
 * are intentional — Supermemory treats containerTags as a set.
 *
 * @internal
 */
export function buildContainerTags(ctx: MemoryContext, prefix: string): string[] {
  const safePrefix = sanitizeIdentifier(prefix, "prefix");
  const tags: string[] = [`${safePrefix}:user:${sanitizeIdentifier(ctx.userId, "userId")}`];
  if (ctx.agentId !== undefined) {
    tags.push(`${safePrefix}:agent:${sanitizeIdentifier(ctx.agentId, "agentId")}`);
  }
  if (ctx.tenantId !== undefined) {
    tags.push(`${safePrefix}:tenant:${sanitizeIdentifier(ctx.tenantId, "tenantId")}`);
  }
  if (ctx.tags !== undefined) {
    for (const t of ctx.tags) {
      tags.push(`${safePrefix}:tag:${sanitizeIdentifier(t, "tag")}`);
    }
  }
  return tags;
}

/**
 * Pick the primary containerTag for `search.memories` (which takes a
 * single string, not an array). The user tag is canonical.
 *
 * @internal
 */
export function primaryContainerTag(ctx: MemoryContext, prefix: string): string {
  const safePrefix = sanitizeIdentifier(prefix, "prefix");
  return `${safePrefix}:user:${sanitizeIdentifier(ctx.userId, "userId")}`;
}
