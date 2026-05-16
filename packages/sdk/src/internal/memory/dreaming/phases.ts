import type { EmbeddingRuntime } from "../embedding-adapter.js";
import type { MemoryFact } from "../types.js";

/**
 * Dreaming/REM phase logic.
 *
 * Three phases:
 *   - **light** — drop near-duplicate facts (cosine similarity > 0.95).
 *   - **REM**  — cluster thematically related facts (cosine ≥ 0.75).
 *   - **deep** — pick a representative bullet per cluster (longest text
 *                wins) and emit consolidated markdown notes.
 *
 * @internal
 */

export interface DedupResult {
  kept: MemoryFact[];
  duplicatesRemoved: number;
}

export interface Cluster {
  representativeText: string;
  members: ReadonlyArray<MemoryFact>;
}

export interface ClusterResult {
  clusters: Cluster[];
}

const DEFAULT_DEDUP_THRESHOLD = 0.95;
const DEFAULT_CLUSTER_THRESHOLD = 0.75;

/** Light phase — drop facts whose embedding is too similar to one already kept. */
export async function lightPhase(
  facts: ReadonlyArray<MemoryFact>,
  embedding: EmbeddingRuntime,
  threshold: number = DEFAULT_DEDUP_THRESHOLD,
): Promise<DedupResult> {
  if (facts.length <= 1) return { kept: [...facts], duplicatesRemoved: 0 };
  const vectors = await embedding.embed(facts.map((f) => f.text));
  const keptIdx: number[] = [];
  const keptVecs: number[][] = [];
  for (let i = 0; i < facts.length; i++) {
    const vec = vectors[i] ?? [];
    const isDup = keptVecs.some((kept) => cosineSimilarity(vec, kept) >= threshold);
    if (isDup) continue;
    keptIdx.push(i);
    keptVecs.push(vec);
  }
  const kept = keptIdx.map((i) => facts[i] as MemoryFact);
  return { kept, duplicatesRemoved: facts.length - kept.length };
}

/** REM phase — single-link agglomerative clustering by cosine similarity. */
export async function remPhase(
  facts: ReadonlyArray<MemoryFact>,
  embedding: EmbeddingRuntime,
  threshold: number = DEFAULT_CLUSTER_THRESHOLD,
): Promise<ClusterResult> {
  if (facts.length === 0) return { clusters: [] };
  const vectors = await embedding.embed(facts.map((f) => f.text));
  const clusterOfIdx = unionFindByPairs(vectors, threshold);
  const groups = bucketFactsByClusterRoot(facts, clusterOfIdx);
  return { clusters: [...groups.values()].map(buildClusterFromMembers) };
}

function unionFindByPairs(
  vectors: ReadonlyArray<ReadonlyArray<number>>,
  threshold: number,
): number[] {
  const clusterOfIdx = vectors.map((_, i) => i);
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      if (cosineSimilarity(vectors[i] ?? [], vectors[j] ?? []) >= threshold) {
        unifyClusters(clusterOfIdx, i, j);
      }
    }
  }
  return clusterOfIdx;
}

function bucketFactsByClusterRoot(
  facts: ReadonlyArray<MemoryFact>,
  clusterOfIdx: number[],
): Map<number, MemoryFact[]> {
  const groups = new Map<number, MemoryFact[]>();
  for (let i = 0; i < facts.length; i++) {
    const root = findRoot(clusterOfIdx, i);
    const list = groups.get(root) ?? [];
    list.push(facts[i] as MemoryFact);
    groups.set(root, list);
  }
  return groups;
}

function buildClusterFromMembers(members: ReadonlyArray<MemoryFact>): Cluster {
  const sorted = [...members].sort((a, b) => b.text.length - a.text.length);
  return { representativeText: sorted[0]?.text ?? "", members };
}

/** Deep phase — render consolidated markdown for the dreamed note. */
export function deepPhase(clusters: ReadonlyArray<Cluster>, timestampMs: number): string {
  if (clusters.length === 0) return "";
  const isoStamp = new Date(timestampMs).toISOString();
  const lines: string[] = [`# Dreamed ${isoStamp}`, ""];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (c === undefined) continue;
    lines.push(`## Cluster ${i + 1}: ${c.representativeText}`);
    lines.push("");
    for (const member of c.members) lines.push(`- ${member.text}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    aNorm += ai * ai;
    bNorm += bi * bi;
  }
  const denom = Math.sqrt(aNorm) * Math.sqrt(bNorm);
  return denom === 0 ? 0 : dot / denom;
}

function findRoot(parents: number[], i: number): number {
  let root = i;
  while (parents[root] !== root) {
    const next = parents[root] ?? root;
    if (next === root) break;
    root = next;
  }
  parents[i] = root;
  return root;
}

function unifyClusters(parents: number[], a: number, b: number): void {
  const rootA = findRoot(parents, a);
  const rootB = findRoot(parents, b);
  if (rootA !== rootB) parents[rootB] = rootA;
}
