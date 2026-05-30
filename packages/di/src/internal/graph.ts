/**
 * Dependency-graph helpers — used by `container.analyze()` for debug + by
 * the registration phase (future) for proactive cycle detection.
 *
 * Per v1.2 EC-11: iterative DFS, NOT recursive, so large graphs (100+ nodes)
 * with multiple cycles don't blow the call stack.
 */

import type { Scope, Token } from "../types.js";

export interface GraphNode {
  readonly token: Token;
  readonly scope: Scope;
  readonly isAsync: boolean;
}

export interface GraphEdge {
  readonly from: Token;
  readonly to: Token;
}

export interface GraphSnapshot {
  readonly nodes: ReadonlyArray<GraphNode>;
  readonly edges: ReadonlyArray<GraphEdge>;
}

/**
 * Find ALL distinct cycles in a directed graph using iterative DFS
 * (Tarjan-style SCC would be overkill for our scale). Returns each cycle
 * as a list of tokens in resolution order, ending at the cycle's first
 * token.
 */
export function findCycles(snapshot: GraphSnapshot): ReadonlyArray<ReadonlyArray<Token>> {
  const adjacency = new Map<Token, Token[]>();
  for (const edge of snapshot.edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const cycles: Token[][] = [];
  const seenCycles = new Set<string>();
  const visited = new Set<Token>();

  for (const node of snapshot.nodes) {
    if (visited.has(node.token)) continue;
    iterativeDfs(node.token, adjacency, visited, cycles, seenCycles);
  }

  return cycles;
}

function iterativeDfs(
  root: Token,
  adjacency: Map<Token, Token[]>,
  visited: Set<Token>,
  out: Token[][],
  seenCycles: Set<string>,
): void {
  // Each frame on the stack: { node, neighbors, index into neighbors }.
  interface Frame {
    node: Token;
    neighbors: ReadonlyArray<Token>;
    next: number;
  }
  const stack: Frame[] = [];
  const onPath = new Set<Token>();
  const pathOrder: Token[] = [];

  function push(node: Token): void {
    if (visited.has(node)) return;
    visited.add(node);
    onPath.add(node);
    pathOrder.push(node);
    stack.push({
      node,
      neighbors: adjacency.get(node) ?? [],
      next: 0,
    });
  }

  push(root);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as Frame;
    if (frame.next >= frame.neighbors.length) {
      onPath.delete(frame.node);
      pathOrder.pop();
      stack.pop();
      continue;
    }
    const neighbor = frame.neighbors[frame.next] as Token;
    frame.next += 1;

    if (onPath.has(neighbor)) {
      // Cycle found from `neighbor` (the back edge target) along pathOrder.
      const cycleStart = pathOrder.indexOf(neighbor);
      const cycle = [...pathOrder.slice(cycleStart), neighbor];
      // Dedupe — same cycle starting from different nodes.
      const key = canonicalCycleKey(cycle);
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        out.push(cycle);
      }
    } else if (!visited.has(neighbor)) {
      push(neighbor);
    }
  }
}

function canonicalCycleKey(cycle: ReadonlyArray<Token>): string {
  // Rotate so the smallest stringified token is first — gives the same key
  // regardless of which node started the DFS.
  const strs = cycle.map(stringifyToken);
  let minIndex = 0;
  for (let i = 1; i < strs.length; i += 1) {
    if ((strs[i] as string) < (strs[minIndex] as string)) {
      minIndex = i;
    }
  }
  return [...strs.slice(minIndex), ...strs.slice(0, minIndex)].join("→");
}

function stringifyToken(token: Token): string {
  if (typeof token === "string") return `s:${token}`;
  if (typeof token === "function") return `c:${(token as { name?: string }).name ?? "<anon>"}`;
  return "u:<unknown>";
}
