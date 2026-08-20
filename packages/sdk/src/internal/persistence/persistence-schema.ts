/**
 * Shared Zod schema for the `{ backend: "memory" | "json", dir? }` options
 * used by both `Workflow` snapshots and `Cache` semantic store persistence.
 * Extracted to remove the cross-module clone flagged by jscpd.
 *
 * `PersistenceSchema` is re-exported from the semver-protected `@theokit/sdk/persistence` barrel
 * and from the semver-exempt `@theokit/sdk/internal/persistence` alias.
 *
 * NOTE — no internal-visibility tag in this block. `tsconfig.base.json` sets `stripInternal: true`,
 * and TypeScript scans EVERY leading comment range of the declaration that follows, including the
 * import right below this one. The tag that used to sit here deleted that import from the emitted
 * `.d.ts`, leaving the types it binds unresolvable for any consumer running type-aware lint
 * (usetheodev/theokit-sdk#283 records the same trap on a declaration).
 */

import { z } from "zod";

/**
 * `persistence?` opt-in JSON disk backend with `dir` required when chosen.
 *
 * `.refine()` restored after Zod v4-only migration (plan zod-v4-migration
 * T1.1, ADR D4). With single v4 instance across workspace, ZodEffects
 * inside `z.object()` works correctly.
 */
export const PersistenceSchema = z
  .object({
    backend: z.enum(["memory", "json"]),
    dir: z.string().optional(),
  })
  .refine((p) => p.backend !== "json" || (typeof p.dir === "string" && p.dir.length > 0), {
    message: 'persistence.dir is required when backend = "json"',
  })
  .optional();
