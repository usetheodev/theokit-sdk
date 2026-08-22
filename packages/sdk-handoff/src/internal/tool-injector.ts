/**
 * Convert `handoffs[]` entries into synthetic `transfer_to_<receiver>` tools
 * for injection into the agent's tool registry at construction time.
 *
 * The synthesized tool's handler calls `dispatchHandoff` internally and
 * returns the receiver's reply as `tool_result`. v1 trade-off documented
 * in dispatcher.ts.
 *
 * @internal
 */

import type { CustomTool, SDKAgent } from "@theokit/sdk";
import { z } from "zod";
import {
  type HandoffDescriptor,
  HandoffNameCollisionError,
  HandoffSelfReferenceError,
} from "../types/handoff.js";
import { dispatchHandoff } from "./dispatcher.js";
import { createChainState } from "./registry.js";
import { slugifyAgentName } from "./slugify-agent-name.js";
import { toJsonSchema } from "./to-json-schema.js";

interface NormalizedHandoff {
  descriptor: HandoffDescriptor;
}

/**
 * Normalize each `handoffs[]` entry to a `HandoffDescriptor`. Raw `SDKAgent`
 * instances are auto-wrapped with default options. Validates:
 *   - EC-6: no self-reference (would cause infinite recursion).
 *   - D215: resolved tool names must be unique.
 */
export function normalizeHandoffs(
  parentAgentId: string,
  entries: ReadonlyArray<SDKAgent | HandoffDescriptor>,
): NormalizedHandoff[] {
  if (entries.length === 0) return [];
  const out: NormalizedHandoff[] = [];
  const seenNames = new Set<string>();
  for (const entry of entries) {
    // Detect raw Agent vs HandoffDescriptor by presence of `.target`.
    const isDescriptor =
      typeof entry === "object" &&
      entry !== null &&
      "target" in entry &&
      "options" in entry &&
      "resolvedToolName" in entry;
    const descriptor = isDescriptor ? (entry as HandoffDescriptor) : autoWrap(entry as SDKAgent);
    if (descriptor.target.agentId === parentAgentId) {
      throw new HandoffSelfReferenceError(parentAgentId);
    }
    const name = descriptor.resolvedToolName;
    if (seenNames.has(name)) {
      throw new HandoffNameCollisionError(name);
    }
    seenNames.add(name);
    out.push({ descriptor });
  }
  return out;
}

function autoWrap(agent: SDKAgent): HandoffDescriptor {
  const name = resolveTargetName(agent);
  return {
    target: agent,
    options: {},
    resolvedToolName: `transfer_to_${name}`,
  };
}

function resolveTargetName(agent: SDKAgent): string {
  // Prefer a `name` field if exposed; fall back to a short agentId slug.
  const candidate = (agent as unknown as { name?: string }).name ?? agent.agentId ?? "anonymous";
  return slugifyAgentName(candidate);
}

/**
 * Build a `CustomTool` for one handoff descriptor. The handler dispatches
 * the handoff using a fresh chain state per `send()`-level invocation.
 *
 * NOTE: this v1 builds a NEW chain state per tool invocation. Pure
 * cross-tool depth tracking within one send() requires per-Agent context
 * — deferred. The single-flight pair guard catches direct ping-pong even
 * without cross-invocation chain (since each call wraps the same depth
 * counter from 1).
 */
export function buildHandoffTool(
  parentAgentId: string,
  descriptor: HandoffDescriptor,
  maxHandoffDepth: number,
): CustomTool {
  const description =
    descriptor.options.toolDescription ??
    `Transfer the conversation to the ${descriptor.target.agentId} agent. ` +
      `Use this when the user's request matches their specialty.`;

  const inputZod =
    descriptor.options.inputType ??
    z.object({
      reason: z.string().optional().describe("Brief reason for the transfer (one short sentence)."),
    });
  // CustomTool.inputSchema expects a JSON schema (Record<string, unknown>),
  // not the raw Zod type. Convert lazily so we don't fail when Zod is missing.
  // Universal Zod 3+4 conversion (feature-detects native v4, falls back to lib on v3).
  const inputSchema = toJsonSchema(inputZod);

  return {
    name: descriptor.resolvedToolName,
    description,
    inputSchema,
    handler: async (
      input: unknown,
      ctx?: { messages?: ReadonlyArray<unknown> },
    ): Promise<string> => {
      const chainState = createChainState(parentAgentId, maxHandoffDepth);
      try {
        const { reply, result } = await dispatchHandoff({
          descriptor,
          senderAgentId: parentAgentId,
          chainState,
          rawInputJson: input,
          // #354 — the supervisor's transcript, which the SDK hands every tool handler as
          // `ctx.messages`. This used to be `{ messages: [] }` with the note "v1: history replay
          // deferred", so the dispatcher found no user message and sent the receiver the
          // placeholder instead of the question — and `inputFilter`, the documented redaction
          // hook, was handed an empty transcript to redact.
          history: { messages: ctx?.messages ?? [] },
        });
        return JSON.stringify({
          ok: true,
          transferred_to: result.to,
          depth: result.depth,
          reply,
        });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.name : "HandoffError",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
