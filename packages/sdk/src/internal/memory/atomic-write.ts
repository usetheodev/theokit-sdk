/**
 * @deprecated Import from `../persistence/atomic-write.js` instead.
 * Maintained as re-export for backward compatibility (ADR D59).
 *
 * @internal
 */

export type { AtomicWriteJsonOptions } from "../persistence/atomic-write.js";
export { atomicWriteJson, replaceFileAtomic } from "../persistence/atomic-write.js";
