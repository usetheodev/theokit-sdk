/**
 * Hierarchical memory scopes — path-based isolation for multi-agent setups.
 *
 * Inspired by a peer project's `MemoryScope` with path hierarchy.
 * Per ADR D4: scope stored as TEXT column, prefix-matched via LIKE.
 *
 * @internal
 */

export function normalizeScopePath(path: string): string {
  const cleaned = `/${path}`.replace(/\/+/g, "/").replace(/\/+$/, "");
  return cleaned || "/";
}

export interface ScopeSearchOptions {
  scopePrefix?: string;
}

export class MemoryScope {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = normalizeScopePath(rootPath);
  }

  get path(): string {
    return this.rootPath;
  }

  child(subPath: string): MemoryScope {
    const normalized = subPath.replace(/^\/+/, "");
    return new MemoryScope(`${this.rootPath}/${normalized}`);
  }

  toSearchOptions(): ScopeSearchOptions {
    return { scopePrefix: this.rootPath };
  }
}
