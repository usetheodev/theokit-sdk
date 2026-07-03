/**
 * JSON disk-backed cache store (ADR D265).
 *
 * One file per namespace at `<dir>/<namespace>.json`. Uses
 * `atomicWriteText` (D60) for crash-safe writes. Debounced flush (200ms)
 * to coalesce bursts.
 *
 * EC-7: corrupt JSON load → log warn + treat as empty cache. Never
 * propagates parse errors that would block `Agent.create`.
 *
 * Layered behind `InMemoryCacheStore` — disk is just persistence; all
 * lookups still hit the in-memory Map for O(1) KV / O(N) vector scan.
 *
 * @internal
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteText } from "@theokit/sdk/internal/persistence";
import type { CacheEntry, CacheStats } from "../types/cache.js";
import { type CacheStore, InMemoryCacheStore } from "./store.js";

interface SerializedSnapshot {
  readonly _schemaVersion: 1;
  readonly namespace: string;
  readonly entries: ReadonlyArray<CacheEntry>;
}

const FLUSH_DEBOUNCE_MS = 200;

export class JsonFileCacheStore implements CacheStore {
  private readonly inner: InMemoryCacheStore;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;

  constructor(
    private readonly dir: string,
    private readonly namespace: string,
    maxEntries: number,
  ) {
    this.inner = new InMemoryCacheStore(maxEntries);
  }

  /** Hydrate from disk. EC-7: corrupt file → empty cache. */
  async hydrate(): Promise<void> {
    const file = this.filePath();
    try {
      const raw = await readFile(file, "utf8");
      let parsed: SerializedSnapshot;
      try {
        parsed = JSON.parse(raw) as SerializedSnapshot;
      } catch (err) {
        console.warn(
          `[cache] corrupt snapshot at ${file}, starting fresh:`,
          err instanceof Error ? err.message : err,
        );
        return;
      }
      if (parsed._schemaVersion !== 1) {
        console.warn(
          `[cache] unsupported schema v${parsed._schemaVersion} at ${file}, starting fresh`,
        );
        return;
      }
      // Only load entries for this namespace (defensive).
      const valid = parsed.entries.filter((e) => e.namespace === this.namespace);
      this.inner.loadAll(valid);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      console.warn(`[cache] failed to read ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  kvGet(key: string, now: number): CacheEntry | undefined {
    return this.inner.kvGet(key, now);
  }

  semanticSearch(
    vector: ReadonlyArray<number>,
    threshold: number,
    embedderId: string,
    namespace: string,
    now: number,
    modelId: string,
  ): { entry: CacheEntry; distance: number } | undefined {
    return this.inner.semanticSearch(vector, threshold, embedderId, namespace, now, modelId);
  }

  set(entry: CacheEntry): void {
    this.inner.set(entry);
    this.markDirty();
  }

  delete(key: string): void {
    this.inner.delete(key);
    this.markDirty();
  }

  async clear(): Promise<void> {
    await this.inner.clear();
    this.markDirty();
    await this.flush();
  }

  stats(): CacheStats {
    return this.inner.stats();
  }

  evictExpired(now: number): number {
    const n = this.inner.evictExpired(now);
    if (n > 0) this.markDirty();
    return n;
  }

  /** Force write the current snapshot. Called on shutdown / clear. */
  async flush(): Promise<void> {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.dirty) return;
    await this.writeSnapshot();
    this.dirty = false;
  }

  /** Counters proxied to inner. */
  incrementKvHits(): void {
    this.inner.incrementKvHits();
  }
  incrementSemanticHits(): void {
    this.inner.incrementSemanticHits();
  }
  incrementMisses(): void {
    this.inner.incrementMisses();
  }
  incrementExcluded(): void {
    this.inner.incrementExcluded();
  }
  incrementEmbedderFailures(): void {
    this.inner.incrementEmbedderFailures();
  }

  private filePath(): string {
    return join(this.dir, `${this.namespace}.json`);
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer === undefined) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush().catch((err) =>
          console.warn(`[cache] debounced flush failed:`, err instanceof Error ? err.message : err),
        );
      }, FLUSH_DEBOUNCE_MS);
    }
  }

  private async writeSnapshot(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const snapshot: SerializedSnapshot = {
      _schemaVersion: 1,
      namespace: this.namespace,
      entries: this.inner.dump(),
    };
    const serialized = JSON.stringify(snapshot);
    await atomicWriteText(this.filePath(), serialized);
  }
}
