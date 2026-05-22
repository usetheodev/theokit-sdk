/**
 * Handoff registry — pure state container per `Agent` instance.
 *
 * Holds the active dispatch chain (for depth + pair tracking) across the
 * lifetime of a single `agent.send()` call. Cleared between calls.
 *
 * @internal
 */

import { HandoffLoopError, HandoffPairLoopError } from "../../types/handoff.js";

export interface HandoffChainState {
  /** Ordered chain of agentIds traversed so far (oldest first). */
  readonly chain: string[];
  /** Set of "<sender>-><receiver>" keys for pair-level loop detection (D221). */
  readonly seenPairs: Set<string>;
  /** Caller-supplied max depth (D218). */
  readonly maxDepth: number;
}

export function createChainState(rootAgentId: string, maxDepth: number): HandoffChainState {
  return {
    chain: [rootAgentId],
    seenPairs: new Set(),
    maxDepth,
  };
}

/**
 * Record a handoff hop. Throws on depth-exceed (D218) or pair-loop (D221).
 * Mutates the state in place.
 */
export function recordHop(
  state: HandoffChainState,
  senderAgentId: string,
  receiverAgentId: string,
): void {
  const pairKey = `${senderAgentId}->${receiverAgentId}`;
  if (state.seenPairs.has(pairKey)) {
    throw new HandoffPairLoopError(senderAgentId, receiverAgentId);
  }
  state.seenPairs.add(pairKey);
  state.chain.push(receiverAgentId);
  // chain.length = nodes; depth = hops = chain.length - 1.
  const depth = state.chain.length - 1;
  if (depth > state.maxDepth) {
    throw new HandoffLoopError(state.maxDepth, [...state.chain]);
  }
}

export function currentDepth(state: HandoffChainState): number {
  return state.chain.length - 1;
}
