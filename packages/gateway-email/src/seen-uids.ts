/**
 * Bounded `Set<number>` of dispatched IMAP UIDs (ADR D331).
 *
 * Caps at 5000 entries; trims to 4000 (drops oldest 1000) on overflow.
 * Same pattern as the Teams ConversationReferenceStore / WhatsApp Web bridge
 * — bounded memory in long-running bots.
 *
 * @internal
 */

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __seenUidsMarker: unique symbol = Symbol("seen-uids");

export class SeenUidSet {
  private set = new Set<number>();
  static readonly MAX_SIZE = 5000;
  static readonly TRIM_TO = 4000;

  has(uid: number): boolean {
    return this.set.has(uid);
  }

  add(uid: number): void {
    if (this.set.size >= SeenUidSet.MAX_SIZE) this.trim();
    this.set.add(uid);
  }

  private trim(): void {
    // Set iteration is insertion-ordered in JS. Drop oldest until at TRIM_TO.
    const target = SeenUidSet.TRIM_TO;
    const toDrop = this.set.size - target;
    if (toDrop <= 0) return;
    let i = 0;
    for (const key of this.set) {
      if (i >= toDrop) break;
      this.set.delete(key);
      i++;
    }
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
  }
}
