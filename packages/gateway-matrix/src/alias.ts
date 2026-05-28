/**
 * Matrix alias resolution + caching (D419).
 *
 * Accepts:
 * - Room id (`!abc123:server`) — pass-through.
 * - Alias (`#general:server`) — resolved via `client.getRoomIdForAlias`.
 *
 * Other shapes throw `ConfigurationError({ code: "invalid_room_ref" })`.
 */

import { ConfigurationError } from "./errors.js";

export interface AliasResolverClient {
  getRoomIdForAlias(alias: string): Promise<{ room_id: string }>;
}

export class AliasCache {
  private readonly cache = new Map<string, string>();

  /** Returns the room id; resolves aliases via the client + caches. */
  async resolve(client: AliasResolverClient, refOrId: string): Promise<string> {
    if (refOrId.startsWith("!")) return refOrId;
    if (!refOrId.startsWith("#")) {
      throw new ConfigurationError({
        code: "invalid_room_ref",
        message: `gateway-matrix: invalid room reference ${JSON.stringify(refOrId)} — expected '!' (room id) or '#' (alias)`,
      });
    }
    const cached = this.cache.get(refOrId);
    if (cached !== undefined) return cached;
    const { room_id } = await client.getRoomIdForAlias(refOrId);
    this.cache.set(refOrId, room_id);
    return room_id;
  }

  /** Drop all cached resolutions. Useful for tests + admin-rename recovery. */
  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
